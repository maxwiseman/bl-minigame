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
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
const { readProjectChannels, completeProjectReview, reviewPrefix } = await import("../agent/lib/project-review.ts");
const { default: memory } = await import("../agent/memory/project.ts");
const { default: reviewTool } = await import("../agent/tools/review_project_channels.ts");
const { default: completeTool } = await import("../agent/tools/complete_project_review.ts");
const { fileMemory, inMemory } = await import("eve/memory/file");

const signal = new AbortController().signal;
const snowflake = ((BigInt(Date.now() - 1_420_070_400_000) << BigInt(22)) - BigInt(1000)).toString();
const nextId = (n) => (BigInt(snowflake) + BigInt(n)).toString();
const message = (n, extra = {}) => ({
    id: nextId(n), content: "The radio link uses XBees", timestamp: new Date().toISOString(),
    edited_timestamp: null, author: { id: "10", username: "Max" }, ...extra,
});
let rows, requests, page, channelGuild, failHistory;
const store = {
    async get(key) { return rows.get(key) ?? null; },
    async set(key, value) { rows.set(key, value); },
    async eval(_script, keys, args) {
        const current = rows.has(keys[0]) ? JSON.stringify(rows.get(keys[0])) : "";
        if (current !== args[0]) return 0;
        rows.set(keys[0], JSON.parse(args[1]));
        rows.set(keys[1], JSON.parse(args[2]));
        rows.delete(keys[2]);
        return 1;
    },
};
const result = (toolName, toolCallId, output = { type: "json", value: null }) => ({
    role: "tool", content: [{ type: "tool-result", toolName, toolCallId, output }],
});
const reviewed = [result("review_project_channels", "read-1"), result("project__save_memory", "save-1")];

beforeEach(() => {
    process.env.DISCORD_GUILD_ID = "200";
    process.env.DISCORD_AMBIENT_CHANNEL_IDS = "100,101";
    process.env.DISCORD_BOT_TOKEN = "test-only";
    process.env.VERCEL_ENV = "test";
    rows = new Map(); requests = []; page = [message(2), message(1)]; channelGuild = "200"; failHistory = false;
    globalThis.fetch = async (url) => {
        requests.push(String(url));
        if (String(url).includes("/messages?")) {
            if (failHistory) return new Response(null, { status: 403 });
            return Response.json(page);
        }
        return Response.json({ guild_id: channelGuild, name: "avionics" });
    };
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
});

test("reads configured history chronologically, preserving source links and bot attribution", async () => {
    page.push(message(3, { author: { id: "11", username: "Bot", bot: true } }));
    const batch = await readProjectChannels(store, "100", "read-1", signal);
    assert.deepEqual(batch.messages.map(m => m.id), [nextId(1), nextId(2), nextId(3)]);
    assert.equal(batch.messages[0].source, `https://discord.com/channels/200/100/${nextId(1)}`);
    assert.equal(batch.messages[0].evidence, true);
    assert.equal(batch.messages[2].evidence, false);
    assert.match(requests[1], /after=\d+&limit=50$/);
    assert.equal(rows.has(`${reviewPrefix()}:cursor:100`), false);
});

test("checkpoints only after saving, then resumes with exact large snowflake", async () => {
    const batch = await readProjectChannels(store, "100", "read-1", signal);
    const input = { reviewId: batch.reviewId, summary: "Learned the reported radio hardware" };
    await assert.rejects(completeProjectReview(store, input, reviewed.slice(0, 1)), /Save useful/);
    await completeProjectReview(store, input, reviewed);
    assert.deepEqual(rows.get(`${reviewPrefix()}:cursor:100`), { through: nextId(2) });
    page = [message(4), message(3)];
    await readProjectChannels(store, "100", "read-2", signal);
    assert.match(requests.at(-1), new RegExp(`after=${nextId(2)}&limit=50$`));
    assert.equal(rows.get(`${reviewPrefix()}:last:100`).messageCount, 2);
});

test("failed saves and another session's work cannot advance review", async () => {
    const batch = await readProjectChannels(store, "100", "read-1", signal);
    const input = { reviewId: batch.reviewId, summary: "Learned something" };
    await assert.rejects(completeProjectReview(store, input, [reviewed[0], result("project__save_memory", "save", { type: "error-text", value: "full" })]), /Save useful/);
    await assert.rejects(completeProjectReview(store, { ...input, nothingToLearn: "duplicates" }, [reviewed[1]]), /session that read/);
    assert.equal(rows.has(`${reviewPrefix()}:cursor:100`), false);
});

test("explicitly uninformative or duplicate pages can be checkpointed without saving", async () => {
    const batch = await readProjectChannels(store, "100", "read-1", signal);
    await completeProjectReview(store, { reviewId: batch.reviewId, summary: "Reviewed", nothingToLearn: "Existing memory already records these reports" }, [reviewed[0]]);
    assert.equal(rows.get(`${reviewPrefix()}:last:100`).nothingToLearn, "Existing memory already records these reports");
});

test("concurrent reviewers cannot overwrite newer progress", async () => {
    const a = await readProjectChannels(store, "100", "read-1", signal);
    const b = await readProjectChannels(store, "100", "read-1", signal);
    await completeProjectReview(store, { reviewId: a.reviewId, summary: "Saved" }, reviewed);
    await assert.rejects(completeProjectReview(store, { reviewId: b.reviewId, summary: "Saved" }, reviewed), /Another review/);
});

test("permission failures and empty histories never discard unread messages", async () => {
    failHistory = true;
    await assert.rejects(readProjectChannels(store, "100", "read-1", signal), /403/);
    assert.equal(rows.size, 0);
    failHistory = false; page = [];
    assert.equal((await readProjectChannels(store, "100", "read-1", signal)).caughtUp, true);
    assert.equal(rows.size, 0);
});

test("missing message content intent cannot silently checkpoint blank human messages", async () => {
    page = [message(1, { content: "" })];
    await assert.rejects(readProjectChannels(store, "100", "read-1", signal), /Message Content Intent/);
    assert.equal(rows.size, 0);
});

test("restricts history to enabled channels in the configured guild", async () => {
    await assert.rejects(readProjectChannels(store, "999", "read-1", signal), /not enabled/);
    assert.equal(requests.length, 0);
    channelGuild = "another-guild";
    await assert.rejects(readProjectChannels(store, "100", "read-1", signal));
    assert.equal(requests.length, 1);
    process.env.DISCORD_AMBIENT_CHANNEL_IDS = "";
    assert.equal((await readProjectChannels(store, undefined, "read-1", signal)).disabled, true);
});

test("users and announcements cannot invoke background review tools", async () => {
    for (const tool of [reviewTool, completeTool]) {
        assert.throws(() => tool.execute({}, { session: { auth: { current: { authenticator: "discord-interaction", principalType: "user", principalId: "10", attributes: { guild_id: "200" } } } } }), /Only background/);
    }
    assert.equal(requests.length, 0);
});

test("dreaming, server conversations and announcements share project memory while DMs are excluded", () => {
    const scope = (auth) => memory.scope({ session: { auth: { current: auth } } });
    assert.deepEqual(scope({ authenticator: "app", principalId: "eve:app", principalType: "runtime" }), ["guild", "200"]);
    assert.deepEqual(scope({ principalType: "user", attributes: { guild_id: "200" } }), ["guild", "200"]);
    assert.deepEqual(scope({ principalType: "service", attributes: { guild_id: "200" } }), ["guild", "200"]);
    assert.equal(scope({ principalType: "user", attributes: {} }), null);
});

test("native Eve project facts persist across sessions and support correction", async () => {
    const provider = fileMemory({ backend: inMemory(), maxCharacters: 12000 });
    const ctx = { memory: { slot: "project", scope: { key: "guild:200" } }, abortSignal: signal };
    const tools = await provider.tools(ctx);
    await tools.save_memory.execute({ text: "2026-11-12: radio testing is pending; source: Discord" }, ctx);
    const recalled = await provider.recall["turn.started"]({ ...ctx, session: { id: "new-session" } });
    assert.match(recalled.messages[0].content, /radio testing is pending/);
    await tools.save_memory.execute({ text: "2026-11-13: radio testing passed, per Max; source: Discord" }, ctx);
    await tools.remove_memory.execute({ index: 0 }, ctx);
    const updated = await provider.recall["turn.started"](ctx);
    assert.match(updated.messages[0].content, /radio testing passed/);
    assert.doesNotMatch(updated.messages[0].content, /testing is pending/);
});
