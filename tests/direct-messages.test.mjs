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
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
const { onDiscordMessage } = await import("../agent/channels/discord.ts");
const { default: team } = await import("../agent/memory/team.ts");
const { default: project } = await import("../agent/memory/project.ts");
const { default: nicknameTool } = await import("../agent/tools/change_nickname.ts");

const message = {
    id: "300", channelId: "100", content: "What do you remember about our cameras?",
    author: { id: "400", username: "account-name", globalName: "Global Name", isBot: false },
    attachments: [], addressed: true, raw: {},
};
let requests, posts, status, member;
const ctx = { discord: { applicationId: "500", post: async text => posts.push(text) } };
const scope = (memory, auth) => memory.scope({ session: { auth: { current: auth } } });

beforeEach(() => {
    requests = []; posts = []; status = 200;
    member = { user: { id: "400" }, nick: "Max", roles: ["600"] };
    process.env.DISCORD_API_URL = "https://discord.invalid";
    process.env.DISCORD_BOT_TOKEN = "test-only";
    process.env.DISCORD_GUILD_ID = "200";
    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        if (String(url).includes("/members/")) return Response.json(member, { status });
        if (String(url).endsWith("/roles")) return Response.json([{ id: "600", name: "Software", position: 1 }]);
        if (String(url).includes("/messages?")) return Response.json([]);
        if (String(url).startsWith("https://redis.invalid")) return Response.json(String(url).endsWith("/pipeline") ? [{ result: "OK" }] : { result: "OK" });
        throw new Error(`Unexpected request: ${url}`);
    };
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
});

test("verified DMs use server nickname, roles and exactly the server's two memory scopes", async () => {
    const dm = await onDiscordMessage(ctx, message);
    assert(dm);
    assert(requests.some(request => request.url === "https://discord.invalid/guilds/200/members/400"));
    assert.equal(dm.auth.attributes.memory_guild_id, "200");
    assert.equal(dm.auth.attributes.guild_id, undefined);
    assert(dm.context.some(line => line.includes("Speaker: Max") && line.includes("Software") && line.includes("400")));
    assert(dm.context.some(line => line.includes("verified member")));
    const server = await onDiscordMessage(ctx, { ...message, guildId: "200", raw: { member } });
    for (const memory of [team, project]) {
        assert.deepEqual(scope(memory, dm.auth), ["guild", "200"]);
        assert.deepEqual(scope(memory, dm.auth), scope(memory, server.auth));
    }
    assert.deepEqual(posts, []);
});

test("nonmembers are rejected before any agent history, cooldown or memory access", async () => {
    status = 404;
    assert.equal(await onDiscordMessage(ctx, message), null);
    assert.equal(requests.length, 1);
    assert.match(posts[0], /only chat in DMs with members/);
});

test("membership is checked again on every DM, including after a member leaves", async () => {
    assert(await onDiscordMessage(ctx, message));
    status = 404;
    assert.equal(await onDiscordMessage(ctx, { ...message, id: "301" }), null);
    assert.equal(requests.filter(request => request.url.includes("/members/")).length, 2);
});

test("lookup failures, malformed members and mismatched users never grant shared memory", async () => {
    for (const candidate of [
        { status: 403, member },
        { status: 429, member },
        { status: 500, member },
        { status: 200, member: {} },
        { status: 200, member: { ...member, user: { id: "someone-else" } } },
    ]) {
        status = candidate.status; member = candidate.member;
        assert.equal(await onDiscordMessage(ctx, message), null);
        assert.match(posts.at(-1), /couldn't verify/);
    }
    assert(!requests.some(request => request.url.startsWith("https://redis.invalid")));
});

test("missing server configuration does not fall back to sharing arbitrary memory", async () => {
    delete process.env.DISCORD_GUILD_ID;
    assert.equal(await onDiscordMessage(ctx, message), null);
    assert.equal(requests.length, 0);
});

test("members without server nicknames fall back to their global display name", async () => {
    member.nick = null;
    const dm = await onDiscordMessage(ctx, message);
    assert(dm.context.some(line => line.includes("Speaker: Global Name")));
});

test("shared-memory DMs still cannot change the bot's server nickname", async () => {
    const dm = await onDiscordMessage(ctx, message);
    const requestCount = requests.length;
    await assert.rejects(nicknameTool.execute({ nickname: "New name" }, {
        session: { auth: { current: dm.auth } }, abortSignal: new AbortController().signal,
    }), /only be changed/);
    assert.equal(requests.length, requestCount);
});
