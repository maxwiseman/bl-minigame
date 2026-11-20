import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        throw error;
    }
} });
const { default: tool } = await import("../agent/tools/clickup.ts");
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const caller = { authenticator: "discord-interaction", principalType: "user", attributes: { user_id: "400", guild_id: "200" } };
const run = (input, auth = caller, signal) => tool.execute(tool.inputSchema.parse(input), {
    session: { auth: { current: auth } }, abortSignal: signal ?? new AbortController().signal,
});
const task = {
    id: "9hx", name: "Camera test", list: { id: "123", name: "Electronics" },
    status: { status: "in progress", type: "custom" }, due_date: "1790000000000", date_updated: "1780000000000",
    description: "Check cameras", assignees: [{ id: 12, username: "Example", email: "private@example.invalid" }],
    sharing: { token: "private-share-token" }, attachments: [{ url: "https://private.invalid" }],
    custom_fields: [{ value: "private-field" }],
};
let requests, data, status, membership, tokenStatus, tokenError, networkError;
beforeEach(() => {
    requests = []; data = { tasks: [task], last_page: true }; status = 200; membership = 200; tokenStatus = 200; tokenError = false; networkError = false;
    process.env.DISCORD_API_URL = "https://discord.invalid";
    process.env.DISCORD_GUILD_ID = "200";
    process.env.DISCORD_BOT_TOKEN = "test-only-discord";
    process.env.CLICKUP_CONNECTOR = "clickup/test-connector";
    process.env.CLICKUP_LIST_IDS = "123, 456,123";
    process.env.VERCEL_OIDC_TOKEN = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.sig`;
    delete process.env.VERCEL_OIDC_TOKEN_FILE;
    globalThis.fetch = async (url, options) => {
        const address = String(url);
        requests.push({ url: address, options });
        if (address.startsWith("https://discord.invalid/")) return Response.json({ user: { id: "400" }, roles: [] }, { status: membership });
        if (address.startsWith("https://api.vercel.com/")) {
            if (tokenError) throw new Error("sensitive-token-error");
            return Response.json(tokenStatus === 200 ? { token: "test-only-clickup", expiresAt: Date.now() + 60_000 } : { error: { message: "sensitive-token-error" } }, { status: tokenStatus });
        }
        assert(address.startsWith("https://api.clickup.com/api/v2/"), address);
        if (networkError) throw new Error("sensitive-network-error");
        return Response.json(data, { status });
    };
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
});
const apiRequests = () => requests.filter(r => r.url.startsWith("https://api.clickup.com/"));

test("configured lists are deduplicated; metadata lookup is restricted and projected", async () => {
    assert.deepEqual(await run({ action: "configured_lists" }), { listIds: ["123", "456"] });
    assert.equal(requests.length, 1);
    data = { id: "123", name: "Electronics", content: "private content", folder: { name: "private" } };
    const result = await run({ action: "get_list", listId: "123" });
    assert.deepEqual(result.list, { id: "123", name: "Electronics" });
    assert(Number.isFinite(Date.parse(result.fetchedAt)));
    assert.equal(apiRequests()[0].url, "https://api.clickup.com/api/v2/list/123");
});

test("Connect app token, fixed GET endpoint, pagination and minimized task fields", async () => {
    data.last_page = false;
    const result = await run({ action: "list_tasks", listId: "123", page: 2, includeClosed: true });
    const exchange = requests.find(r => r.url.startsWith("https://api.vercel.com/"));
    assert(exchange.url.endsWith("/clickup%2Ftest-connector"));
    assert.deepEqual(JSON.parse(exchange.options.body).subject, { type: "app" });
    const request = apiRequests()[0];
    const url = new URL(request.url);
    assert.equal(url.pathname, "/api/v2/list/123/task");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("include_closed"), "true");
    assert.equal(url.searchParams.get("include_timl"), "false");
    assert.equal(url.searchParams.get("subtasks"), "true");
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.redirect, "error");
    assert.equal(request.options.headers.Authorization, "Bearer test-only-clickup");
    assert(request.options.signal instanceof AbortSignal);
    assert.equal(result.nextPage, 3);
    assert.equal(result.tasks[0].url, "https://app.clickup.com/t/9hx");
    assert.deepEqual(result.tasks[0].assignees, [{ id: 12, name: "Example" }]);
    assert.equal(result.tasks[0].description, undefined);
    for (const secret of ["private@", "private-share", "private-field", "private.invalid", "test-only-clickup"]) assert(!JSON.stringify(result).includes(secret));
});

test("defaults exclude closed tasks and start at zero; unknown full-page continuation is conservative", async () => {
    data = { tasks: Array.from({ length: 100 }, () => task) };
    const result = await run({ action: "list_tasks", listId: "123" });
    assert.equal(result.nextPage, 1);
    assert.equal(result.page, 0);
    assert.equal(result.includeClosed, false);
    data = { tasks: [] };
    assert.equal((await run({ action: "list_tasks", listId: "123" })).nextPage, null);
});

test("task detail is bounded, linked, and checks the returned ID and home list", async () => {
    data = { ...task, description: "x".repeat(9000) };
    const result = await run({ action: "get_task", taskId: "9hx" });
    assert.equal(result.task.description.length, 8000);
    assert.equal(result.task.descriptionTruncated, true);
    data = { ...task, id: "other" };
    await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /different task/);
    data = { ...task, list: { id: "999", name: "Private" } };
    await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /home list is not enabled/);
    data = { tasks: [data] };
    await assert.rejects(run({ action: "list_tasks", listId: "123" }), /home list is not enabled/);
    data = { tasks: [{ ...task, list: { id: "456", name: "Other enabled list" } }] };
    await assert.rejects(run({ action: "list_tasks", listId: "123" }), /home list is not enabled/);
    data = { id: "456", name: "Other" };
    await assert.rejects(run({ action: "get_list", listId: "123" }), /different list/);
});

test("invalid inputs cannot supply URLs, paths, credentials, writes or alternate subjects", () => {
    for (const input of [
        { action: "get_task", taskId: "../team" }, { action: "get_task", taskId: "id?foo=bar" },
        { action: "get_list", listId: "https://example.invalid" }, { action: "get_list", listId: "123", url: "https://example.invalid" },
        { action: "list_tasks", listId: "123", page: -1 }, { action: "list_tasks", listId: "123", page: 1.2 },
        { action: "create_task", listId: "123" }, { action: "get_task", taskId: "9hx", subject: { type: "user", id: "other" } },
    ]) assert.equal(tool.inputSchema.safeParse(input).success, false);
    assert.equal(requests.length, 0);
});

test("untrusted callers, other servers, ambient turns, schedules and announcements cannot read", async () => {
    for (const auth of [null, { ...caller, authenticator: "leaderboard" }, { ...caller, principalType: "service" },
        { ...caller, attributes: { ...caller.attributes, ambient: "true" } },
        { ...caller, attributes: { ...caller.attributes, guild_id: "999" } },
        { ...caller, attributes: { user_id: "400" } },
    ]) await assert.rejects(run({ action: "configured_lists" }, auth), /direct request/);
    assert.equal(requests.length, 0);
});

test("verified DMs work, but membership is rechecked before every read and fails closed", async () => {
    const dm = { ...caller, attributes: { user_id: "400", memory_guild_id: "200" } };
    await run({ action: "configured_lists" }, dm);
    membership = 404;
    await assert.rejects(run({ action: "list_tasks", listId: "123" }, dm), /no longer a member/);
    membership = 503;
    await assert.rejects(run({ action: "configured_lists" }), /Membership lookup failed/);
    assert.equal(requests.length, 3);
    assert.equal(apiRequests().length, 0);
});

test("missing/malformed configuration and non-enabled lists fail before token exchange", async () => {
    for (const ids of ["", "123,invalid", Array.from({ length: 21 }, (_, i) => String(i)).join(",")]) {
        process.env.CLICKUP_LIST_IDS = ids;
        await assert.rejects(run({ action: "configured_lists" }), /not configured/);
    }
    process.env.CLICKUP_LIST_IDS = "123";
    process.env.CLICKUP_CONNECTOR = "github/wrong-provider";
    await assert.rejects(run({ action: "configured_lists" }), /not configured/);
    process.env.CLICKUP_CONNECTOR = "clickup/test-connector";
    await assert.rejects(run({ action: "list_tasks", listId: "999" }), /not enabled/);
    assert(requests.every(r => r.url.startsWith("https://discord.invalid/")));
});

test("upstream failures are actionable without exposing response bodies or credentials", async () => {
    tokenStatus = 403;
    await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /ClickUp authorization failed/);
    tokenStatus = 200; tokenError = true;
    await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /ClickUp authorization failed/);
    tokenError = false;
    for (const [code, message] of [[401, /denied access/], [403, /denied access/], [404, /not found/], [429, /rate-limited/], [500, /failed \(500\)/]]) {
        status = code; data = { error: "sensitive-upstream-error" };
        await assert.rejects(run({ action: "get_task", taskId: "9hx" }), message);
    }
    status = 200; data = { unexpected: "sensitive-payload" };
    await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /unexpected response/);
    networkError = true;
    await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /failed or timed out/);
});

test("malformed JSON and aborted body reads return sanitized errors", async () => {
    const mockFetch = globalThis.fetch;
    for (const broken of [
        () => new Response("sensitive-invalid-json"),
        () => ({ ok: true, status: 200, json: async () => { throw new Error("sensitive-body-abort"); } }),
    ]) {
        globalThis.fetch = async (url, options) => String(url).startsWith("https://api.clickup.com/") ? broken() : mockFetch(url, options);
        await assert.rejects(run({ action: "get_task", taskId: "9hx" }), /^Error: ClickUp returned invalid JSON or the response timed out\.$/);
    }
});

test("cancellation while Connect stalls rejects promptly and never starts a ClickUp request", async () => {
    const mockFetch = globalThis.fetch;
    const controller = new AbortController();
    let started;
    const exchangeStarted = new Promise(resolve => { started = resolve; });
    globalThis.fetch = async (url, options) => {
        if (String(url).startsWith("https://api.vercel.com/")) {
            started();
            return new Promise(() => {});
        }
        return mockFetch(url, options);
    };
    const pending = run({ action: "get_task", taskId: "9hx" }, caller, controller.signal);
    await exchangeStarted;
    controller.abort();
    await assert.rejects(pending, /authorization cancelled or timed out/);
    assert.equal(apiRequests().length, 0);
});
