import { z } from "zod";
import { clickupClient, row, rows, id, numericId, asId, pick, type Row, type Query, type ClickupClient } from "./client";
import type { Caller } from "../coding/access";
type Auth = Caller | null | undefined;
const ids = z.array(id).min(1).max(30);
const userIds = z.array(numericId).min(1).max(100);
const names = z.array(z.string().trim().min(1).max(200)).min(1).max(30);
const timestamp = z.number().int().nonnegative().max(8640000000000000).describe("Unix milliseconds; convert calendar dates using the requested report timezone.");
const page = z.number().int().min(0).max(10000).default(0);
const cursor = z.string().max(2000).optional();
const textWindow = { offset: z.number().int().min(0).default(0), maxChars: z.number().int().min(100).max(20000).default(12000) };
export function textSlice(text: string, offset: number, maxChars: number) {
    return { text: text.slice(offset, offset + maxChars), offset, totalChars: text.length,
        nextOffset: offset + maxChars < text.length ? offset + maxChars : null };
}
const description = (task: Row) => String(task.markdown_description ?? task.description ?? task.text_content ?? "");
export const taskSummary = (task: Row) => ({ ...pick(task, ["id", "custom_id", "name", "status", "assignees", "priority", "due_date", "start_date", "date_created", "date_updated", "date_done", "date_closed", "parent", "list", "folder", "space", "tags", "time_estimate", "time_spent"]), url: task.url ?? `https://app.clickup.com/t/${asId(task.id)}` });
const found = (data: unknown, key: string) => rows(row(data)[key]);
function selected(values: Row[], query?: string) {
    return query ? values.filter(value => JSON.stringify(pick(value, ["name", "username", "email", "handle"])).toLowerCase().includes(query.toLowerCase())) : values;
}

export const hierarchyInput = z.object({
    level: z.enum(["workspace", "space", "folder", "list"]).default("workspace"),
    resourceId: id.optional(), archived: z.boolean().default(false),
}).strict().refine(input => input.level === "workspace" || !!input.resourceId, "resourceId is required below Workspace level.");
export async function hierarchy(input: z.infer<typeof hierarchyInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    if (input.level === "workspace") return { workspace: pick(c.workspace, ["id", "name"]), spaces: await c.getSpaces(input.archived) };
    const resourceId = input.resourceId!;
    if (input.level === "space") {
        const space = await c.space(resourceId);
        const folders = found(await c.get(`/v2/space/${resourceId}/folder`, { archived: input.archived }), "folders");
        const lists = found(await c.get(`/v2/space/${resourceId}/list`, { archived: input.archived }), "lists");
        return { space, folders, folderlessLists: lists, note: "Expand each folder with level=folder to find its lists and subfolders." };
    }
    if (input.level === "folder") return { folder: await c.folder(resourceId), lists: found(await c.get(`/v2/folder/${resourceId}/list`, { archived: input.archived }), "lists") };
    return { list: await c.list(resourceId) };
}

export const memberInput = z.object({ query: z.string().trim().min(1).max(200).optional() }).strict();
export async function members(input: z.infer<typeof memberInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    const all = rows(c.workspace.members).map(member => pick(row(member.user), ["id", "username", "email", "initials"]));
    return { workspaceId: c.workspaceId, members: selected(all, input.query), note: "ClickUp IDs are separate from Discord IDs. Resolve the named person explicitly; never assume the shared token owner is the requester." };
}
export async function groups(input: z.infer<typeof memberInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    return { workspaceId: c.workspaceId, groups: selected(found(await c.get("/v2/group", { team_id: c.workspaceId }), "groups"), input.query) };
}

export const filterInput = z.object({
    spaceIds: ids.optional(), folderIds: ids.optional(), listIds: ids.optional(),
    assigneeIds: userIds.optional().describe("Explicit ClickUp member IDs only. No 'me' or implicit account owner."),
    groupIds: ids.optional().describe("Explicit ClickUp User Group IDs; resolves their current members to assignees. Prefer List/Folder team scope to include unassigned team work."),
    statuses: names.optional(), tags: names.optional(), includeClosed: z.boolean().default(false), subtasks: z.boolean().default(true),
    dueAfter: timestamp.optional(), dueBefore: timestamp.optional(), updatedAfter: timestamp.optional(), updatedBefore: timestamp.optional(),
    doneAfter: timestamp.optional(), doneBefore: timestamp.optional(), createdAfter: timestamp.optional(), createdBefore: timestamp.optional(),
    orderBy: z.enum(["id", "created", "updated", "due_date"]).default("due_date"), descending: z.boolean().default(false),
    query: z.string().trim().min(1).max(200).optional().describe("Local substring search of names/descriptions on THIS API page only. Follow nextPage even when there are no matches."),
    page,
}).strict().superRefine((value, ctx) => {
    if (value.assigneeIds && value.groupIds) ctx.addIssue({ code: "custom", message: "Choose assigneeIds or groupIds, not both." });
    for (const [after, before] of [[value.dueAfter, value.dueBefore], [value.updatedAfter, value.updatedBefore], [value.doneAfter, value.doneBefore], [value.createdAfter, value.createdBefore]]) {
        if (after !== undefined && before !== undefined && after >= before) ctx.addIssue({ code: "custom", message: "Each after timestamp must precede its before timestamp." });
    }
});
async function filterWith(c: ClickupClient, input: z.infer<typeof filterInput>) {
    for (const value of input.spaceIds ?? []) await c.space(value);
    for (const value of input.folderIds ?? []) await c.folder(value);
    for (const value of input.listIds ?? []) await c.list(value);
    let assignees = input.assigneeIds;
    if (input.groupIds) {
        const all = found(await c.get("/v2/group", { team_id: c.workspaceId, group_ids: input.groupIds }), "groups");
        if (input.groupIds.some(groupId => !all.some(group => asId(group.id) === groupId))) throw new Error("A requested ClickUp User Group was not found in this Workspace.");
        assignees = [...new Set(all.filter(group => input.groupIds!.includes(asId(group.id)))
            .flatMap(group => rows(group.members).map(member => numericId.parse(asId(member.id)))))];
        // An empty group must not turn into an unfiltered query across the whole Workspace.
        if (!assignees.length) return { tasks: [], page: input.page, scanned: 0, nextPage: null, hasMore: false, note: "The selected User Groups have no members." };
    }
    const query: Query = { page: input.page, order_by: input.orderBy, reverse: input.descending, subtasks: input.subtasks,
        include_closed: input.includeClosed, include_markdown_description: true,
        "space_ids[]": input.spaceIds, "project_ids[]": input.folderIds, "list_ids[]": input.listIds,
        "assignees[]": assignees, "statuses[]": input.statuses, "tags[]": input.tags,
        due_date_gt: input.dueAfter, due_date_lt: input.dueBefore, date_updated_gt: input.updatedAfter, date_updated_lt: input.updatedBefore,
        date_done_gt: input.doneAfter, date_done_lt: input.doneBefore, date_created_gt: input.createdAfter, date_created_lt: input.createdBefore };
    const data = row(await c.get(`/v2/team/${c.workspaceId}/task`, query));
    const all = rows(data.tasks);
    const matches = input.query ? all.filter(task => `${task.name}\n${description(task)}`.toLowerCase().includes(input.query!.toLowerCase())) : all;
    const hasMore = typeof data.last_page === "boolean" ? !data.last_page : all.length >= 100;
    return { tasks: matches.map(taskSummary), page: input.page, scanned: all.length, nextPage: hasMore ? input.page + 1 : null,
        hasMore, scope: { workspaceId: c.workspaceId, ...input },
        note: "100 tasks per API page. Counts and search matches cover this page only; follow nextPage before claiming complete coverage. Due dates may be absent; don't invent deadlines. Team scope includes unassigned work unless you explicitly filter assignees or groups." };
}
export async function filterTasks(input: z.infer<typeof filterInput>, caller: Auth, signal?: AbortSignal) {
    return filterWith(await clickupClient(caller, signal), input);
}

export const taskInput = z.object({ taskId: id, customId: z.boolean().default(false), ...textWindow }).strict();
export async function getTask(input: z.infer<typeof taskInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal), task = await c.task(input.taskId, input.customId);
    return { ...taskSummary(task), ...pick(task, ["custom_item_id", "custom_fields", "checklists", "dependencies", "linked_tasks", "subtasks", "attachments", "creator"]),
        description: textSlice(description(task), input.offset, input.maxChars), note: "Task attachments are metadata/links only. Task-linked Docs are not returned by this API; discover them with clickup_search_docs." };
}

export const commentInput = z.object({ taskId: id.optional(), listId: id.optional(), commentId: id.optional(), customId: z.boolean().default(false),
    start: timestamp.optional(), startId: id.optional(), ...textWindow }).strict().superRefine((value, ctx) => {
        if (!!value.taskId === !!value.listId) ctx.addIssue({ code: "custom", message: "Choose taskId or listId to verify the parent, including for threaded replies." });
        if ((value.start === undefined) !== (value.startId === undefined)) ctx.addIssue({ code: "custom", message: "Pagination needs both start and startId." });
    });
export async function comments(input: z.infer<typeof commentInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    const parent = input.taskId ? await c.task(input.taskId, input.customId, false) : await c.list(input.listId!);
    const parentPath = input.taskId ? `/v2/task/${id.parse(asId(parent.id))}/comment` : `/v2/list/${input.listId}/comment`;
    const data = row(await c.get(parentPath, { start: input.start, start_id: input.startId }));
    let items = rows(data.comments);
    if (input.commentId) {
        // Locate the parent comment on its specified page before reading a globally addressed reply endpoint.
        if (!items.some(comment => asId(comment.id) === input.commentId)) throw new Error("Parent comment not found on this page. Read older comments and supply their start/startId page cursor to verify the parent.");
        items = found(await c.get(`/v2/comment/${input.commentId}/reply`), "comments");
    }
    const last = items.at(-1);
    return { comments: items.map(comment => ({ ...pick(comment, ["id", "user", "date", "resolved", "reply_count", "assignee"]),
        content: textSlice(typeof comment.comment_text === "string" ? comment.comment_text : JSON.stringify(comment.comment ?? ""), input.offset, input.maxChars) })),
        next: !input.commentId && items.length >= 25 && last ? { start: Number(last.date), startId: asId(last.id) } : null,
        note: input.commentId ? "Threaded replies endpoint has no pagination; content windows use offset/maxChars." : "Newest first. Read threaded replies using commentId plus the parent taskId/listId and this page's start/startId." };
}

export const fieldInput = z.object({ level: z.enum(["workspace", "space", "folder", "list"]).default("workspace"), resourceId: id.optional() }).strict()
    .refine(value => value.level === "workspace" || !!value.resourceId, "resourceId is required below Workspace level.");
export async function fields(input: z.infer<typeof fieldInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    if (input.level === "space") await c.space(input.resourceId!);
    if (input.level === "folder") await c.folder(input.resourceId!);
    if (input.level === "list") await c.list(input.resourceId!);
    return c.get(`/v2/${input.level === "workspace" ? "team" : input.level}/${input.level === "workspace" ? c.workspaceId : input.resourceId}/field`, { include_applied_objects: true });
}

export const docsInput = z.object({ query: z.string().trim().min(1).max(200).optional(), parentId: id.optional(), parentType: z.enum(["4", "5", "6", "7", "12"]).optional(),
    archived: z.boolean().default(false), cursor, limit: z.number().int().min(10).max(100).default(50) }).strict();
export async function docs(input: z.infer<typeof docsInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    const data = row(await c.get(`/v3/workspaces/${c.workspaceId}/docs`, { parent_id: input.parentId, parent_type: input.parentType, archived: input.archived, deleted: false, cursor: input.cursor, limit: input.limit }));
    return { docs: selected(rows(data.docs), input.query), nextCursor: data.next_cursor ?? null,
        coverage: "Doc titles on this page only, not full-text Doc content or MCP's universal workspace search. Follow nextCursor even on zero matches; then read the page listing and page content." };
}
export const documentInput = z.object({ docId: id, pageId: id.optional(), ...textWindow }).strict();
export async function document(input: z.infer<typeof documentInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal), path = `/v3/workspaces/${c.workspaceId}/docs/${input.docId}`;
    if (!input.pageId) return { docId: input.docId, pages: await c.get(`${path}/page_listing`, { max_page_depth: -1 }), note: "Use a page ID with this tool to read its Markdown content." };
    const page = row(await c.get(`${path}/pages/${input.pageId}`, { content_format: "text/md" }));
    return { ...pick(page, ["id", "doc_id", "name", "parent_page_id", "date_created", "date_updated", "pages"]),
        content: textSlice(String(page.content ?? ""), input.offset, input.maxChars), source: `https://app.clickup.com/${c.workspaceId}/v/dc/${input.docId}/${input.pageId}` };
}

export const timeInput = z.object({ assigneeId: numericId.describe("Explicit member ID required; the shared account's 'current user' is never used."),
    start: timestamp, end: timestamp, taskId: id.optional(), listId: id.optional(), folderId: id.optional(), spaceId: id.optional() }).strict()
    .refine(value => value.end > value.start && value.end - value.start <= 31 * 86400000, "Select a positive range of at most 31 days.");
export async function timeEntries(input: z.infer<typeof timeInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal);
    if (input.taskId) await c.task(input.taskId, false, false);
    if (input.listId) await c.list(input.listId);
    if (input.folderId) await c.folder(input.folderId);
    if (input.spaceId) await c.space(input.spaceId);
    return c.get(`/v2/team/${c.workspaceId}/time_entries`, { assignee: input.assigneeId, start_date: input.start, end_date: input.end,
        task_id: input.taskId, list_id: input.listId, folder_id: input.folderId, space_id: input.spaceId, include_location_names: true, include_task_tags: true });
}
export const statusInput = z.object({ taskId: id, customId: z.boolean().default(false) }).strict();
export async function timeInStatus(input: z.infer<typeof statusInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal), task = await c.task(input.taskId, input.customId, false);
    return c.get(`/v2/task/${id.parse(asId(task.id))}/time_in_status`);
}

export const chatInput = z.object({ channelId: id.optional(), messageId: id.optional(), cursor,
    limit: z.number().int().min(1).max(100).default(25) }).strict().refine(value => !value.messageId || !!value.channelId, "Supply channelId when reading a message's replies.");
export async function chat(input: z.infer<typeof chatInput>, caller: Auth, signal?: AbortSignal) {
    const c = await clickupClient(caller, signal), path = `/v3/workspaces/${c.workspaceId}/chat`;
    if (!input.channelId) return c.get(`${path}/channels`, { cursor: input.cursor, limit: input.limit });
    if (!input.messageId) return c.get(`${path}/channels/${input.channelId}/messages`, { cursor: input.cursor, limit: input.limit, content_format: "text/md" });
    // Replies are Workspace-addressed; the provider enforces that message's Workspace/account access.
    return c.get(`${path}/messages/${input.messageId}/replies`, { cursor: input.cursor, limit: input.limit, content_format: "text/md" });
}
