import { z } from "zod";
import { requireDiscordMember } from "../discord-access";
import type { Caller } from "../coding/access";

export type Row = Record<string, unknown>;
export const row = (value: unknown): Row => z.record(z.string(), z.unknown()).parse(value);
export const rows = (value: unknown): Row[] => z.array(z.record(z.string(), z.unknown())).parse(value);
export const id = z.string().trim().regex(/^[a-zA-Z0-9_-]+$/).max(128);
export const numericId = z.string().trim().regex(/^[1-9]\d*$/).max(30);
export const asId = (value: unknown) => typeof value === "number" || typeof value === "string" ? String(value) : "";
export const pick = (value: Row, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
export type Query = Record<string, string | number | boolean | readonly string[] | undefined>;

async function readJson(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("ClickUp returned an empty response.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) throw new Error("ClickUp response exceeds 2 MB. Narrow the date range or resource scope; no results were silently dropped.");
            chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new Error("ClickUp returned invalid JSON. Retry later; this is not an empty result."); }
}

/** Only fixed-origin GET requests. No arbitrary URL, HTTP method, or provider token is exposed to the agent. */
export async function clickupClient(caller: Caller | null | undefined, signal?: AbortSignal) {
    const token = process.env.CLICKUP_API_TOKEN?.trim();
    if (!token) throw new Error("ClickUp is unavailable. Configure CLICKUP_API_TOKEN in the agent's environment.");
    await requireDiscordMember(caller);
    const requestSignal = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
    const get = async (path: string, query: Query = {}): Promise<unknown> => {
        if (!/^\/v[23]\/[a-zA-Z0-9_/-]+$/.test(path)) throw new Error("Invalid ClickUp read endpoint.");
        const url = new URL(`https://api.clickup.com/api${path}`);
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
            else url.searchParams.set(key, String(value));
        }
        const response = await fetch(url, { method: "GET", headers: { Authorization: token, Accept: "application/json" }, redirect: "error", signal: requestSignal });
        if (!response.ok) {
            const hint = response.status === 429 ? "Rate limited; retry later."
                : [401, 403].includes(response.status) ? "Check the shared API token and account permissions."
                : response.status === 404 ? "Not found or inaccessible; this does not mean there is no work." : "Retry later.";
            // Provider error bodies can contain user data or echoed credentials. Never expose them.
            throw new Error(`ClickUp read failed (${response.status}). ${hint}`);
        }
        return readJson(response);
    };
    const workspaces = rows(row(await get("/v2/team")).teams);
    const configured = process.env.CLICKUP_WORKSPACE_ID?.trim();
    if (configured) numericId.parse(configured);
    const workspace = configured ? workspaces.find(item => asId(item.id) === configured) : workspaces.length === 1 ? workspaces[0] : undefined;
    if (!workspace) throw new Error(configured ? "The shared token cannot access CLICKUP_WORKSPACE_ID." : "Set CLICKUP_WORKSPACE_ID to select one Workspace for the shared bot.");
    const workspaceId = numericId.parse(asId(workspace.id));
    const spaces = new Map<boolean, Row[]>();
    const getSpaces = async (archived = false) => {
        if (!spaces.has(archived)) spaces.set(archived, rows(row(await get(`/v2/team/${workspaceId}/space`, { archived })).spaces));
        return spaces.get(archived)!;
    };
    const spaceDetails = new Map<string, Row>();
    const space = async (spaceId: string) => {
        if (spaceDetails.has(spaceId)) return spaceDetails.get(spaceId)!;
        if (!(await getSpaces()).some(item => asId(item.id) === spaceId)
            && !(await getSpaces(true)).some(item => asId(item.id) === spaceId)) throw new Error("That Space is outside the configured ClickUp Workspace.");
        const result = row(await get(`/v2/space/${id.parse(spaceId)}`));
        spaceDetails.set(spaceId, result);
        return result;
    };
    const folder = async (folderId: string) => {
        const result = row(await get(`/v2/folder/${id.parse(folderId)}`, { include_subfolders: true }));
        await space(asId(row(result.space).id));
        return result;
    };
    const list = async (listId: string) => {
        const result = row(await get(`/v2/list/${id.parse(listId)}`));
        await space(asId(row(result.space).id));
        return result;
    };
    const task = async (taskId: string, customId = false, includeSubtasks = true) => {
        const result = row(await get(`/v2/task/${id.parse(taskId)}`, { custom_task_ids: customId, team_id: workspaceId,
            include_subtasks: includeSubtasks, include_markdown_description: true }));
        if (result.team_id !== undefined) {
            if (asId(result.team_id) !== workspaceId) throw new Error("That task is outside the configured ClickUp Workspace.");
        } else await list(asId(row(result.list).id));
        return result;
    };
    return { get, workspace, workspaceId, getSpaces, space, folder, list, task };
}
export type ClickupClient = Awaited<ReturnType<typeof clickupClient>>;
