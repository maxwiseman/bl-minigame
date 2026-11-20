import { getToken } from "@vercel/connect";
import { z } from "zod";
import { directMessageMember } from "./discord-members";

type Caller = { authenticator?: string; principalType: string; attributes: Record<string, unknown> };
const listId = z.string().regex(/^\d+$/).max(30);
const taskId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100);
export const clickupInput = z.discriminatedUnion("action", [
    z.object({ action: z.literal("configured_lists") }).strict(),
    z.object({ action: z.literal("get_list"), listId }).strict(),
    z.object({
        action: z.literal("list_tasks"), listId,
        page: z.number().int().min(0).max(10_000).default(0),
        includeClosed: z.boolean().default(false),
    }).strict(),
    z.object({ action: z.literal("get_task"), taskId }).strict(),
]);

const listSchema = z.object({ id: listId, name: z.string() });
const taskSchema = z.object({
    id: taskId, name: z.string(), list: listSchema,
    status: z.object({ status: z.string(), type: z.string().optional() }),
    assignees: z.array(z.object({ id: z.number().int(), username: z.string().nullable().optional() })).default([]),
    due_date: z.string().nullable().optional(),
    date_updated: z.string().optional(),
    description: z.string().nullable().optional(),
    priority: z.object({ priority: z.string() }).nullable().optional(),
    parent: z.string().nullable().optional(),
});

function parseResponse<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) throw new Error("ClickUp returned an unexpected response.");
    return result.data;
}

// Connect's SDK has no AbortSignal option. Bound our wait even if its internal
// exchange stalls; the attached rejection handler also consumes late failures.
function waitForToken(operation: Promise<string>, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("ClickUp authorization cancelled or timed out."));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

/** Shared app access: only lists explicitly approved for all server members. */
export async function readClickup(
    rawInput: z.infer<typeof clickupInput>, caller: Caller | null | undefined, abortSignal?: AbortSignal,
) {
    const input = clickupInput.parse(rawInput);
    const guild = process.env.DISCORD_GUILD_ID;
    const user = caller?.attributes.user_id;
    if (!guild || !/^\d+$/.test(guild)
        || caller?.authenticator !== "discord-interaction" || caller.principalType !== "user"
        || typeof user !== "string" || !/^\d+$/.test(user)
        || (caller.attributes.guild_id ?? caller.attributes.memory_guild_id) !== guild
        || caller.attributes.ambient === "true") {
        throw new Error("ClickUp requires a direct request from a verified member of the configured Discord server.");
    }
    if (!await directMessageMember(user)) throw new Error("You are no longer a member of the configured Discord server.");

    const connector = process.env.CLICKUP_CONNECTOR?.trim();
    const configured = z.array(listId).min(1).max(20).safeParse(
        [...new Set((process.env.CLICKUP_LIST_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean))],
    );
    if (!connector || !/^clickup\/[a-zA-Z0-9_-]+$/.test(connector) || !configured.success) {
        throw new Error("ClickUp is not configured. Set CLICKUP_CONNECTOR and CLICKUP_LIST_IDS for lists safe to share with the server.");
    }
    const allowed = new Set(configured.data);
    if (input.action === "configured_lists") return { listIds: configured.data };
    if ("listId" in input && !allowed.has(input.listId)) throw new Error("That ClickUp list is not enabled for this server.");

    const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(abortSignal ? [abortSignal] : [])]);
    let token: string;
    try {
        signal.throwIfAborted();
        // Never accept a subject, connector, token, URL, or installation from model input.
        token = await waitForToken(getToken(connector, { subject: { type: "app" } }, { forceRefresh: true }), signal);
    } catch {
        if (signal.aborted) throw new Error("ClickUp authorization cancelled or timed out.");
        // Connect/vendor errors can contain sensitive upstream details.
        throw new Error("ClickUp authorization failed. Check the Vercel Connect app installation and project/environment link.");
    }
    const path = input.action === "get_task" ? `/task/${input.taskId}`
        : input.action === "get_list" ? `/list/${input.listId}`
        : `/list/${input.listId}/task?${new URLSearchParams({
            page: String(input.page), include_closed: String(input.includeClosed),
            subtasks: "true", archived: "false", include_timl: "false",
        })}`;
    let response: Response;
    let data: unknown;
    try {
        response = await fetch(`https://api.clickup.com/api/v2${path}`, {
            method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            redirect: "error", signal,
        });
    } catch {
        throw new Error("ClickUp request failed or timed out. No task data was retrieved.");
    }
    if (response.status === 401 || response.status === 403) throw new Error("ClickUp denied access. Check the connector's workspace/list permissions.");
    if (response.status === 404) throw new Error("ClickUp item not found or not accessible.");
    if (response.status === 429) throw new Error("ClickUp rate-limited the request. Wait before trying again.");
    if (!response.ok) throw new Error(`ClickUp request failed (${response.status}).`);
    try { data = await response.json(); }
    catch { throw new Error("ClickUp returned invalid JSON or the response timed out."); }

    const fetchedAt = new Date().toISOString();
    if (input.action === "get_list") {
        const list = parseResponse(listSchema, data);
        if (list.id !== input.listId) throw new Error("ClickUp returned a different list.");
        return { fetchedAt, list: { id: list.id, name: list.name.slice(0, 300) } };
    }
    const summarize = (task: z.infer<typeof taskSchema>, detail = false) => {
        // Recheck home list even for list responses; omit secondary-list tasks.
        if (!allowed.has(task.list.id) || ("listId" in input && task.list.id !== input.listId)) {
            throw new Error("Task's home list is not enabled for this request.");
        }
        const description = task.description ?? "";
        return {
            id: task.id, name: task.name.slice(0, 500), status: task.status.status.slice(0, 100),
            statusType: task.status.type, list: { id: task.list.id, name: task.list.name.slice(0, 300) },
            assignees: task.assignees.slice(0, 50).map(person => ({ id: person.id, name: person.username?.slice(0, 100) ?? null })),
            dueDateMs: task.due_date ?? null, updatedAtMs: task.date_updated ?? null,
            priority: task.priority?.priority.slice(0, 100) ?? null, parentId: task.parent ?? null,
            url: `https://app.clickup.com/t/${task.id}`,
            ...(detail ? { description: description.slice(0, 8_000), descriptionTruncated: description.length > 8_000 } : {}),
        };
    };
    if (input.action === "get_task") {
        const task = parseResponse(taskSchema, data);
        if (task.id !== input.taskId) throw new Error("ClickUp returned a different task.");
        return { fetchedAt, task: summarize(task, true) };
    }
    const result = parseResponse(z.object({ tasks: z.array(taskSchema).max(100), last_page: z.boolean().optional() }), data);
    // Without last_page, a full page may have more results. Never call a partial page the entire project.
    const hasMore = result.last_page === undefined ? result.tasks.length === 100 : !result.last_page;
    return {
        fetchedAt, listId: input.listId, page: input.page, includeClosed: input.includeClosed,
        nextPage: hasMore ? input.page + 1 : null,
        tasks: result.tasks.map(task => summarize(task)),
    };
}
