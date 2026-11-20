import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { canReadChannel, channelSchema } = await import("../agent/lib/discord-access.ts");
const { searchDiscord, searchInput, readDiscord, readInput } = await import("../agent/lib/discord-history.ts");
const { prepareTask, taskAuth, canManageTasks, taskInput } = await import("../agent/lib/discord-tasks.ts");
const { discordSkillScopes } = await import("../agent/lib/discord-skills.ts");
const { readAtMost, workspaceFile, postDiscordFile } = await import("../agent/lib/discord-files.ts");
const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
const auth = { authenticator: "discord-interaction", principalType: "user", principalId: "discord:200:400", issuer: "discord:200", attributes: { guild_id: "200", user_id: "400", channel_id: "100", ambient: "false" } };
const dmAuth = { ...auth, principalId: "discord:400", issuer: "discord", attributes: { memory_guild_id: "200", user_id: "400", channel_id: "101" } };
const signal = new AbortController().signal;
const publicChannel = (id = "100") => ({ id, guild_id: "200", type: 0, name: "rocket", permission_overwrites: [] });
const message = (id = "9007199254740993001", channel = "100") => ({ id, channel_id: channel, content: "radio test passed", timestamp: "2026-11-20T01:00:00Z", author: { id: "400", username: "max" }, attachments: [] });
let requests, channels, roles, memberStatus, searchStatus, channelStatus, searchMessages, searchTotal, page, searchThreads;
beforeEach(() => {
    process.env.DISCORD_GUILD_ID = "200";
    process.env.DISCORD_BOT_TOKEN = "test-only";
    process.env.DISCORD_API_URL = "https://discord.invalid";
    requests = []; channels = [publicChannel(), { ...publicChannel("102"), permission_overwrites: [{ id: "200", type: 0, deny: "1024", allow: "0" }] }];
    roles = [{ id: "200", permissions: "66560" }]; memberStatus = 200; searchStatus = 200; channelStatus = 200;
    searchMessages = [[message()]]; searchThreads = []; searchTotal = 1; page = [message()];
    globalThis.fetch = async (url, options = {}) => {
        const u = new URL(url); requests.push({ url: u, ...options });
        if (/\/guilds\/200\/members\//.test(u.pathname)) return Response.json({ user: { id: u.pathname.split("/").at(-1) }, roles: ["600"] }, { status: memberStatus });
        if (u.pathname === "/guilds/200/channels") return Response.json(channels);
        if (u.pathname === "/guilds/200/roles") return Response.json(roles);
        if (u.pathname.endsWith("/messages/search")) return Response.json(searchStatus === 200 ? { total_results: searchTotal, messages: searchMessages, threads: searchThreads } : { retry_after: 2 }, { status: searchStatus });
        if (u.pathname.endsWith("/messages")) {
            if (options.method === "POST") return Response.json({ id: "123", channel_id: "100" });
            return Response.json(page);
        }
        if (u.pathname === "/channels/101") return Response.json({ id: "101", type: 1, recipients: [{ id: "400" }] });
        const channel = channels.find(channel => `/channels/${channel.id}` === u.pathname);
        if (channel) return Response.json(channel, { status: channelStatus });
        throw new Error(`Unexpected request: ${url}`);
    };
});
after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
const session = (caller = auth) => ({ id: "session", auth: { current: caller } });

test("search restricts Discord's index to public channels and returns original source links", async () => {
    searchMessages.push([message("9007199254740993002", "102")]);
    const result = await searchDiscord(searchInput.parse({ query: "radio" }), auth, signal);
    assert.equal(result.matches.length, 1);
    assert.match(result.matches[0].permalink, /200\/100\/9007199254740993001$/);
    const query = requests.find(request => request.url.pathname.endsWith("/search")).url.searchParams;
    assert.deepEqual(query.getAll("channel_id"), ["100"]);
    assert.equal(query.get("sort_by"), "relevance");
    await assert.rejects(searchDiscord(searchInput.parse({ query: "radio", channelIds: ["102"] }), auth), /public channels/);
});

test("search includes public-thread matches but never private threads or threads under private parents", async () => {
    searchThreads = [
        { ...publicChannel("103"), type: 11, parent_id: "100" },
        { ...publicChannel("104"), type: 12, parent_id: "100" },
        { ...publicChannel("105"), type: 11, parent_id: "102" },
    ];
    searchMessages = ["103", "104", "105"].map(id => [message(`9007199254740993${id}`, id)]);
    const result = await searchDiscord(searchInput.parse({ query: "radio" }), auth);
    assert.deepEqual(result.matches.map(match => match.channelId), ["103"]);
});

test("history rejects service/foreign/unverified callers and revoked members", async () => {
    for (const caller of [null, { ...auth, principalType: "service" }, { ...auth, attributes: { user_id: "400", guild_id: "999" } }]) {
        await assert.rejects(searchDiscord(searchInput.parse({ query: "radio" }), caller), /verified member/);
    }
    assert.equal(requests.length, 0);
    memberStatus = 404;
    await assert.rejects(searchDiscord(searchInput.parse({ query: "radio" }), dmAuth), /no longer a member/);
});

test("indexing, rate limits and pagination cannot masquerade as an empty completed search", async () => {
    searchStatus = 202;
    assert.equal((await searchDiscord(searchInput.parse({ query: "radio" }), auth)).unavailable, true);
    searchStatus = 429;
    await assert.rejects(searchDiscord(searchInput.parse({ query: "radio" }), auth), /429/);
    searchStatus = 200; searchMessages = []; searchTotal = 25;
    const result = await searchDiscord(searchInput.parse({ query: "radio", limit: 10 }), auth);
    assert.equal(result.nextOffset, 10);
    assert.equal(result.matches.length, 0);
});

test("permission evaluation applies everyone, aggregate roles, and final member denies", () => {
    const channel = channelSchema.parse({ ...publicChannel(), permission_overwrites: [
        { id: "200", type: 0, deny: "1024", allow: "0" },
        { id: "600", type: 0, deny: "0", allow: "1024" },
        { id: "400", type: 1, deny: "65536", allow: "0" },
    ] });
    assert(!canReadChannel(channel, "200", roles));
    assert(canReadChannel(channel, "200", roles, { userId: "401", roles: ["600"] }));
    assert(!canReadChannel(channel, "200", roles, { userId: "400", roles: ["600"] }));
});

test("public thread reads preserve exact snowflakes and reject private threads", async () => {
    channels.push({ ...publicChannel("103"), type: 11, parent_id: "100" });
    page = [message("9007199254740993002", "103"), message("9007199254740993001", "103")];
    const result = await readDiscord(readInput.parse({ channelId: "103", limit: 2 }), auth);
    assert.equal(result.messages[0].id, "9007199254740993001");
    assert.equal(result.nextBefore, "9007199254740993001");
    channels.at(-1).type = 12;
    await assert.rejects(readDiscord(readInput.parse({ channelId: "103" }), auth), /public channels/);
    assert(!readInput.safeParse({ channelId: "100", around: "1", before: "2" }).success);
});

test("tasks capture their destination from the authenticated conversation only", async () => {
    const payload = await prepareTask({ task: "Summarize radio progress" }, { session: session(), abortSignal: signal });
    assert.deepEqual(payload, { task: "Summarize radio progress", guildId: "200", userId: "400", channelId: "100", dm: false });
    const dm = await prepareTask({ task: "Remind me" }, { session: session(dmAuth), abortSignal: signal });
    assert.equal(dm.dm, true); assert.equal(dm.channelId, "101");
    assert(!taskInput.safeParse({ task: "Remind me", channelId: "102" }).success);
    assert(!canManageTasks({ ...session(), schedule: {} }));
    assert(!canManageTasks(session({ ...auth, attributes: { ...auth.attributes, ambient: "true" } })));
    await assert.rejects(prepareTask({ task: "Loop" }, { session: { ...session(), schedule: {} } }), /direct Discord request/);
});

test("scheduled runs revalidate the creator and revoke access after membership or channel loss", async () => {
    const payload = { task: "Report", guildId: "200", userId: "400", channelId: "100", dm: false };
    const principal = { type: "user", authenticator: auth.authenticator, principalId: auth.principalId, issuer: auth.issuer };
    const current = await taskAuth(principal, payload);
    assert.equal(current.attributes.scheduled_task, "true");
    assert.equal(current.attributes.ambient, "true");
    assert.equal(await taskAuth({ ...principal, principalId: "discord:200:999" }, payload), null);
    memberStatus = 404;
    assert.equal(await taskAuth(principal, payload), null);
    memberStatus = 200;
    channels[0].permission_overwrites = [{ id: "400", type: 1, deny: "1024", allow: "0" }];
    assert.equal(await taskAuth(principal, payload), null);
    channels[0] = publicChannel(); channelStatus = 503;
    await assert.rejects(taskAuth(principal, payload), /503/);
});

test("personal skills follow stable IDs across DMs while shared skills remain conversation-scoped", () => {
    const server = discordSkillScopes({ session: session(), conversation: { space: { id: "channel:100", type: "channel" } } });
    const dm = discordSkillScopes({ session: session(dmAuth), conversation: { space: { id: "dm:101", type: "direct" } } });
    assert.equal(server[0].key, dm[0].key);
    assert.equal(server[1].shared, true); assert.equal(dm.length, 1);
    const other = discordSkillScopes({ session: session({ ...auth, attributes: { ...auth.attributes, user_id: "401" } }) });
    assert.notEqual(other[0].key, server[0].key);
    assert.deepEqual(discordSkillScopes({ session: session({ ...auth, principalType: "service" }) }), []);
    assert(discordSkillScopes({ session: session({ ...auth, attributes: { ...auth.attributes, ambient: "true" } }) }).every(scope => scope.readOnly));
});

test("bounded uploads preserve binary bytes, omit pings and use a retry nonce", async () => {
    const bytes = Uint8Array.from([0, 255, 16]);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    assert.deepEqual([...await readAtMost(stream)], [...bytes]);
    const result = await postDiscordFile("100", "/workspace/report.bin", bytes, "Test report", signal, "12345");
    assert.equal(result.posted, true);
    const form = requests.at(-1).body;
    assert.deepEqual(JSON.parse(form.get("payload_json")).allowed_mentions, { parse: [] });
    assert.equal(JSON.parse(form.get("payload_json")).nonce, "12345");
    assert.deepEqual([...new Uint8Array(await form.get("files[0]").arrayBuffer())], [...bytes]);
    await assert.rejects(postDiscordFile("100", "empty", new Uint8Array()), /nonempty/);
});

test("uploads cancel oversized streams and reject paths outside the workspace", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
    await assert.rejects(readAtMost(stream, 3), /upload limit/); assert(cancelled);
    assert.equal(workspaceFile("report.csv", "/workspace"), "/workspace/report.csv");
    assert.throws(() => workspaceFile("../etc/passwd", "/workspace"), /workspace/);
    assert.throws(() => workspaceFile("/workspace-other/file", "/workspace"), /workspace/);
});

test("native skill repository persists versions through Redis documents and rejects stale writes", async () => {
    const { redisDocuments } = await import("@upstash/agentkit-eve/memory");
    const { documentRepository } = await import("eve/experimental/extensions/custom-skills/repository");
    const rows = new Map();
    const redis = { hmget: async key => rows.get(key) ?? null,
        eval: async (_script, [key], [content, expected, version]) => {
            if ((rows.get(key)?.version ?? "") !== expected) return [0];
            rows.set(key, { content, version }); return [1];
        } };
    const backend = redisDocuments({ redis, enableTelemetry: false });
    const repo = () => documentRepository({ backend, namespace: "test/skills" });
    const scope = { name: "personal", key: "user:400", label: "you", shared: false };
    const version = { description: "Use when checking a release", markdown: "Read the checklist", applicationMode: "on-demand", checksum: "hash", validation: { valid: true, errors: [], warnings: [] }, savedBy: { principalId: "400", label: "Max" } };
    const first = await repo().appendVersion(scope, { id: "12345678-1234-4123-8123-123456789012", name: "release", expectedLatest: null, expectedRevision: null, version, activate: true });
    const saved = await repo().getHead(scope, "release");
    assert.equal(saved.id, first.head.id); assert.equal(saved.liveVersion, 1);
    await assert.rejects(repo().appendVersion(scope, { id: saved.id, name: "release", expectedLatest: 1, expectedRevision: null, version, activate: false }), /changed|conflict|stale/i);
    assert.equal((await repo().listHeads({ ...scope, key: "user:401" })).heads.length, 0);
});
