import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const api = await import("../agent/lib/clickup/read.ts");
const { clickupClient } = await import("../agent/lib/clickup/client.ts");
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
const caller = { authenticator: "discord-interaction", principalType: "user", attributes: { guild_id: "200", user_id: "400" } };
const workspace = { id: "300", name: "SSTA", members: [{ user: { id: 123, username: "Max", email: "max@example.invalid" } }, { user: { id: 124, username: "Jake" } }] };
const task = (n = 1) => ({ id: `task${n}`, team_id: "300", name: `Task ${n}`, status: { status: "blocked", type: "custom" },
    markdown_description: "A".repeat(150) + "needle", assignees: [], priority: { priority: "high" }, due_date: "1795222800000", date_updated: "1795222800000", list: { id: "600", name: "C2" },
    dependencies: [{ task_id: "task2" }], linked_tasks: [{ task_id: "task3" }], custom_fields: [{ id: "field", value: "option" }],
    checklists: [{ id: "check", items: [{ name: "Inspect radios", resolved: false }] }], subtasks: [{ id: "child", name: "Child" }], attachments: [{ id: "file", url: "https://files.invalid/report.pdf" }] });
let requests, memberStatus, workspaces, overrides, tasks, groups;
beforeEach(() => {
    process.env.CLICKUP_API_TOKEN = "pk_test-only";
    process.env.CLICKUP_WORKSPACE_ID = "300";
    process.env.DISCORD_GUILD_ID = "200";
    process.env.DISCORD_BOT_TOKEN = "discord-test";
    process.env.DISCORD_API_URL = "https://discord.invalid";
    requests = []; memberStatus = 200; workspaces = [workspace]; overrides = new Map(); tasks = [task()]; groups = [{ id: "group1", name: "Controls", members: [{ id: 123 }, { id: 124 }] }];
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(url); requests.push({ url: u, ...init });
        if (init.signal?.aborted) throw init.signal.reason;
        if (u.origin === "https://discord.invalid") return Response.json({ user: { id: "400" }, roles: [] }, { status: memberStatus });
        assert.equal(u.origin, "https://api.clickup.com");
        assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.redirect, "error");
        assert.equal(init.headers.Authorization, "pk_test-only"); assert.ok(init.signal instanceof AbortSignal);
        if (overrides.has(u.pathname)) {
            const value = overrides.get(u.pathname); return typeof value === "function" ? value(u, init) : Response.json(value);
        }
        const p = u.pathname.replace(/^\/api/, "");
        if (p === "/v2/team") return Response.json({ teams: workspaces });
        if (p === "/v2/team/300/space") return Response.json({ spaces: u.searchParams.get("archived") === "true" ? [{ id: "401", name: "Archive" }] : [{ id: "400", name: "Projects" }] });
        if (p === "/v2/space/400" || p === "/v2/space/401") return Response.json({ id: p.split("/").at(-1), name: "Projects" });
        if (p === "/v2/space/400/folder") return Response.json({ folders: [{ id: "500", name: "Big Liquid" }] });
        if (p === "/v2/space/400/list") return Response.json({ lists: [{ id: "601", name: "General" }] });
        if (p === "/v2/folder/500") return Response.json({ id: "500", space: { id: "400" }, name: "Big Liquid", subfolders: [{ id: "501" }] });
        if (p === "/v2/folder/500/list") return Response.json({ lists: [{ id: "600", name: "C2" }] });
        if (p === "/v2/list/600") return Response.json({ id: "600", name: "C2", space: { id: "400" }, statuses: [{ status: "blocked" }, { status: "done" }] });
        if (p === "/v2/team/300/task") return Response.json({ tasks });
        if (p === "/v2/group") return Response.json({ groups });
        if (p === "/v2/task/task1" || p === "/v2/task/DEV-123") return Response.json(task());
        if (p.endsWith("/field")) return Response.json({ fields: [{ id: "field", type: "drop_down", type_config: { options: [{ id: "option", name: "Ready" }] } }] });
        if (p === "/v2/task/task1/comment" || p === "/v2/list/600/comment") return Response.json({ comments: [{ id: "comment1", date: "1795222800000", user: { id: 123 }, comment_text: "Radio test passed", reply_count: 1 }] });
        if (p === "/v2/comment/comment1/reply") return Response.json({ comments: [{ id: "reply1", comment_text: "Confirmed" }] });
        if (p === "/v3/workspaces/300/docs") return Response.json({ docs: [{ id: "doc1", name: "Radio reference" }], next_cursor: "next-doc-page" });
        if (p === "/v3/workspaces/300/docs/doc1/page_listing") return Response.json([{ id: "page1", name: "Radio", pages: [{ id: "page2", name: "Keys" }] }]);
        if (p === "/v3/workspaces/300/docs/doc1/pages/page1") return Response.json({ id: "page1", name: "Radio", content: "M".repeat(150) + "end" });
        if (p === "/v2/team/300/time_entries") return Response.json({ data: [{ id: "time1", user: { id: 124 }, duration: "10000" }] });
        if (p === "/v2/task/task1/time_in_status") return Response.json({ current_status: { status: "blocked", total_time: { by_minute: 30 } } });
        if (p.startsWith("/v3/workspaces/300/chat/")) return Response.json({ data: [{ id: "chat1", content: "Test complete" }], next_cursor: "chat-next" });
        throw new Error(`Unexpected ClickUp route: ${u.pathname}`);
    };
});
const apiRequests = () => requests.filter(request => request.url.origin === "https://api.clickup.com");
const queryOf = suffix => apiRequests().findLast(request => request.url.pathname.endsWith(suffix)).url.searchParams;

test("requires configured token and current membership, including scheduled and DM reads", async () => {
    delete process.env.CLICKUP_API_TOKEN;
    await assert.rejects(api.hierarchy(api.hierarchyInput.parse({}), caller), /CLICKUP_API_TOKEN/);
    assert.equal(requests.length, 0);
    process.env.CLICKUP_API_TOKEN = "pk_test-only";
    await assert.rejects(api.hierarchy(api.hierarchyInput.parse({}), null), /verified member/);
    memberStatus = 404;
    await assert.rejects(api.hierarchy(api.hierarchyInput.parse({}), caller), /no longer a member/);
    assert.equal(apiRequests().length, 0);
    memberStatus = 200;
    const scheduled = { ...caller, attributes: { ...caller.attributes, scheduled_task: "true" } };
    const dm = { ...caller, attributes: { user_id: "400", memory_guild_id: "200" } };
    await api.hierarchy(api.hierarchyInput.parse({}), scheduled);
    await api.hierarchy(api.hierarchyInput.parse({}), dm);
    assert.equal(requests.filter(r => r.url.origin === "https://discord.invalid").length, 3);
});

test("selects one Workspace and blocks cross-Workspace tasks, lists, and unsafe IDs", async () => {
    delete process.env.CLICKUP_WORKSPACE_ID;
    assert.equal((await api.hierarchy(api.hierarchyInput.parse({}), caller)).workspace.id, "300");
    workspaces.push({ id: "301", name: "Personal", members: [] });
    await assert.rejects(api.hierarchy(api.hierarchyInput.parse({}), caller), /Set CLICKUP_WORKSPACE_ID/);
    process.env.CLICKUP_WORKSPACE_ID = "302";
    await assert.rejects(api.hierarchy(api.hierarchyInput.parse({}), caller), /cannot access/);
    process.env.CLICKUP_WORKSPACE_ID = "300";
    overrides.set("/api/v2/task/task1", { ...task(), team_id: "301" });
    await assert.rejects(api.getTask(api.taskInput.parse({ taskId: "task1" }), caller), /outside/);
    overrides.set("/api/v2/list/600", { id: "600", space: { id: "999" } });
    await assert.rejects(api.hierarchy(api.hierarchyInput.parse({ level: "list", resourceId: "600" }), caller), /outside/);
    assert.throws(() => api.taskInput.parse({ taskId: "../../evil?token=x" }));
    const client = await clickupClient(caller);
    await assert.rejects(client.get("//evil.invalid/"), /Invalid ClickUp/);
});

test("hierarchy expands folderless lists, folder subfolders, list statuses and archives", async () => {
    const space = await api.hierarchy(api.hierarchyInput.parse({ level: "space", resourceId: "400" }), caller);
    assert.equal(space.folders[0].name, "Big Liquid"); assert.equal(space.folderlessLists[0].id, "601");
    const folder = await api.hierarchy(api.hierarchyInput.parse({ level: "folder", resourceId: "500" }), caller);
    assert.equal(folder.folder.subfolders[0].id, "501"); assert.equal(folder.lists[0].id, "600");
    assert.equal((await api.hierarchy(api.hierarchyInput.parse({ level: "list", resourceId: "600" }), caller)).list.statuses[0].status, "blocked");
    assert.equal((await api.hierarchy(api.hierarchyInput.parse({ archived: true }), caller)).spaces[0].id, "401");
});

test("daily team filters combine scope, statuses, dates and due ordering without an implicit assignee", async () => {
    const result = await api.filterTasks(api.filterInput.parse({ folderIds: ["500"], listIds: ["600"], tags: ["radio comms"], statuses: ["blocked"],
        dueAfter: 1000, dueBefore: 2000, updatedAfter: 500, orderBy: "due_date" }), caller);
    const query = queryOf("/team/300/task");
    assert.deepEqual(query.getAll("project_ids[]"), ["500"]); assert.deepEqual(query.getAll("list_ids[]"), ["600"]);
    assert.deepEqual(query.getAll("tags[]"), ["radio comms"]); assert.deepEqual(query.getAll("statuses[]"), ["blocked"]);
    assert.equal(query.get("due_date_gt"), "1000"); assert.equal(query.get("due_date_lt"), "2000"); assert.equal(query.get("date_updated_gt"), "500");
    assert.equal(query.get("order_by"), "due_date"); assert.equal(query.get("reverse"), "false");
    assert.equal(query.get("subtasks"), "true"); assert.equal(query.get("include_closed"), "false");
    assert.equal(query.has("assignees[]"), false); assert.deepEqual(result.tasks[0].assignees, []);
    assert.equal(result.tasks[0].url, "https://app.clickup.com/t/task1"); assert.equal(result.nextPage, null);
    await api.filterTasks(api.filterInput.parse({ includeClosed: true, doneAfter: 100, doneBefore: 200, orderBy: "updated", descending: true }), caller);
    const done = queryOf("/team/300/task"); assert.equal(done.get("date_done_gt"), "100"); assert.equal(done.get("include_closed"), "true"); assert.equal(done.get("reverse"), "true");
});

test("group-based reports use explicit current members and empty groups never query all tasks", async () => {
    await api.filterTasks(api.filterInput.parse({ groupIds: ["group1"] }), caller);
    assert.deepEqual(queryOf("/team/300/task").getAll("assignees[]"), ["123", "124"]);
    assert.deepEqual(queryOf("/group").getAll("group_ids"), ["group1"]);
    groups[0].members = []; requests = [];
    const empty = await api.filterTasks(api.filterInput.parse({ groupIds: ["group1"] }), caller);
    assert.deepEqual(empty.tasks, []); assert.equal(apiRequests().some(r => r.url.pathname.endsWith("/task")), false);
    await assert.rejects(api.filterTasks(api.filterInput.parse({ groupIds: ["missing"] }), caller), /not found/);
    assert.throws(() => api.filterInput.parse({ assigneeIds: ["me"] }));
    assert.throws(() => api.filterInput.parse({ assigneeIds: ["123"], groupIds: ["group1"] }));
    assert.throws(() => api.filterInput.parse({ dueAfter: 20, dueBefore: 10 }));
});

test("task search is honest about page coverage and continues on zero matches", async () => {
    tasks = Array.from({ length: 100 }, (_, i) => ({ ...task(i), markdown_description: "No keyword here" }));
    const result = await api.filterTasks(api.filterInput.parse({ query: "missing", page: 2 }), caller);
    assert.equal(result.scanned, 100); assert.deepEqual(result.tasks, []); assert.equal(result.nextPage, 3); assert.equal(result.hasMore, true);
    assert.match(result.note, /this page only/); assert.equal(queryOf("/team/300/task").get("page"), "2");
    tasks = [task()];
    assert.equal((await api.filterTasks(api.filterInput.parse({ query: "needle" }), caller)).tasks.length, 1);
});

test("full task reads preserve acceptance criteria, relationships, attachments and continuation offsets", async () => {
    const first = await api.getTask(api.taskInput.parse({ taskId: "DEV-123", customId: true, maxChars: 100 }), caller);
    assert.equal(first.description.nextOffset, 100); assert.equal(first.description.totalChars, 156);
    const rest = await api.getTask(api.taskInput.parse({ taskId: "task1", offset: first.description.nextOffset, maxChars: 100 }), caller);
    assert.equal(first.description.text + rest.description.text, task().markdown_description);
    assert.equal(rest.description.nextOffset, null); assert.equal(first.dependencies[0].task_id, "task2");
    assert.equal(first.custom_fields[0].value, "option"); assert.equal(first.subtasks[0].id, "child"); assert.equal(first.attachments[0].id, "file");
    const query = queryOf("/task/DEV-123"); assert.equal(query.get("custom_task_ids"), "true"); assert.equal(query.get("team_id"), "300"); assert.equal(query.get("include_subtasks"), "true");
});

test("comments paginate by both timestamp and ID and verify threaded reply parents", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ id: `comment${i}`, date: String(2000-i), comment_text: `Comment ${i}`, reply_count: 1 }));
    overrides.set("/api/v2/task/task1/comment", { comments: items });
    const result = await api.comments(api.commentInput.parse({ taskId: "task1" }), caller);
    assert.deepEqual(result.next, { start: 1976, startId: "comment24" });
    overrides.set("/api/v2/task/task1/comment", { comments: [{ id: "comment1", comment_text: "Old comment" }] });
    const replies = await api.comments(api.commentInput.parse({ taskId: "task1", commentId: "comment1", start: 1976, startId: "comment24" }), caller);
    assert.equal(replies.comments[0].content.text, "Confirmed"); assert.equal(queryOf("/task/task1/comment").get("start_id"), "comment24");
    await assert.rejects(api.comments(api.commentInput.parse({ taskId: "task1", commentId: "foreign" }), caller), /Parent comment not found/);
    assert.throws(() => api.commentInput.parse({ taskId: "task1", start: 2000 }));
});

test("Docs discover titles with cursors and read nested pages and complete Markdown", async () => {
    const noMatches = await api.docs(api.docsInput.parse({ query: "Missing", cursor: "old-cursor" }), caller);
    assert.equal(noMatches.docs.length, 0); assert.equal(noMatches.nextCursor, "next-doc-page"); assert.match(noMatches.coverage, /not full-text/);
    assert.equal(queryOf("/docs").get("cursor"), "old-cursor");
    const listing = await api.document(api.documentInput.parse({ docId: "doc1" }), caller);
    assert.equal(listing.pages[0].pages[0].id, "page2");
    const first = await api.document(api.documentInput.parse({ docId: "doc1", pageId: "page1", maxChars: 100 }), caller);
    const rest = await api.document(api.documentInput.parse({ docId: "doc1", pageId: "page1", offset: first.content.nextOffset, maxChars: 100 }), caller);
    assert.equal(first.content.text + rest.content.text, "M".repeat(150) + "end"); assert.equal(rest.content.nextOffset, null);
    assert.equal(queryOf("/pages/page1").get("content_format"), "text/md");
});

test("explicit member lookup, field options, groups, work logs, status history and Chat are read-only", async () => {
    assert.equal((await api.members(api.memberInput.parse({ query: "jake" }), caller)).members[0].id, 124);
    assert.equal((await api.groups(api.memberInput.parse({ query: "controls" }), caller)).groups[0].id, "group1");
    assert.equal((await api.fields(api.fieldInput.parse({ level: "list", resourceId: "600" }), caller)).fields[0].type_config.options[0].name, "Ready");
    const time = await api.timeEntries(api.timeInput.parse({ assigneeId: "124", start: 100, end: 200, listId: "600" }), caller);
    assert.equal(time.data[0].user.id, 124); assert.equal(queryOf("/time_entries").get("assignee"), "124");
    assert.throws(() => api.timeInput.parse({ start: 100, end: 200 }));
    assert.equal((await api.timeInStatus(api.statusInput.parse({ taskId: "task1" }), caller)).current_status.status, "blocked");
    assert.equal((await api.chat(api.chatInput.parse({ channelId: "channel1", cursor: "cursor1" }), caller)).next_cursor, "chat-next");
    await api.chat(api.chatInput.parse({ channelId: "channel1", messageId: "message1" }), caller);
    assert.ok(apiRequests().every(r => r.method === "GET" && !r.body));
});

test("API errors, body limits and cancellation are never represented as empty results or leak token bodies", async () => {
    for (const status of [401, 403, 404, 429, 500]) {
        overrides.set("/api/v2/team/300/task", () => Response.json({ error: "pk_secret-do-not-display" }, { status }));
        await assert.rejects(api.filterTasks(api.filterInput.parse({}), caller), error => error.message.includes(String(status)) && !error.message.includes("pk_secret"));
    }
    overrides.set("/api/v2/team/300/task", () => new Response("X".repeat(2_000_001)));
    await assert.rejects(api.filterTasks(api.filterInput.parse({}), caller), /exceeds 2 MB/);
    overrides.set("/api/v2/team/300/task", () => new Response("not JSON"));
    await assert.rejects(api.filterTasks(api.filterInput.parse({}), caller), /invalid JSON/);
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await assert.rejects(api.filterTasks(api.filterInput.parse({}), caller, controller.signal), /cancelled/);
});

test("Eve tool execution uses requester's auth and never opens a sandbox", async () => {
    const tool = (await import("../agent/tools/clickup_filter_tasks.ts")).default;
    const ctx = { session: { auth: { current: caller } }, abortSignal: new AbortController().signal, getSandbox() { throw new Error("Sandbox must stay closed"); } };
    const result = await tool.execute(api.filterInput.parse({ listIds: ["600"] }), ctx);
    assert.equal(result.tasks[0].id, "task1");
});
