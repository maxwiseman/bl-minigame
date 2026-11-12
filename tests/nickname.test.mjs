import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        throw error;
    }
} });
const { default: nicknameTool } = await import("../agent/tools/change_nickname.ts");

const originalFetch = globalThis.fetch;
const originalToken = process.env.DISCORD_BOT_TOKEN;
let requests;
let status;
const ctx = {
    session: { auth: { current: {
        authenticator: "discord-interaction", principalType: "user", principalId: "user:123",
        attributes: { guild_id: "456" },
    } } },
    abortSignal: new AbortController().signal,
};

beforeEach(() => {
    requests = [];
    status = 200;
    process.env.DISCORD_BOT_TOKEN = "test-only";
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return Response.json({}, { status });
    };
});

after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
});

test("can only PATCH the authenticated bot in the current server", async () => {
    const input = nicknameTool.inputSchema.parse({ nickname: "  Big Liquid Jr  " });
    assert.deepEqual(await nicknameTool.execute(input, ctx), { nickname: "Big Liquid Jr", changed: true });
    assert.equal(requests[0].url, "https://discord.com/api/v10/guilds/456/members/@me");
    assert.equal(requests[0].options.method, "PATCH");
    assert.deepEqual(JSON.parse(requests[0].options.body), { nick: "Big Liquid Jr" });
});

test("rejects alternate target IDs and invalid nicknames", () => {
    for (const input of [
        { nickname: "Name", userId: "someone-else" },
        { nickname: "Name", guildId: "another-server" },
        { nickname: " " },
        { nickname: "x".repeat(33) },
    ]) assert.equal(nicknameTool.inputSchema.safeParse(input).success, false);
    assert.equal(requests.length, 0);
});

test("DMs, automatic announcements, and invalid server IDs cannot change nicknames", async () => {
    for (const caller of [
        { ...ctx.session.auth.current, attributes: {} },
        { ...ctx.session.auth.current, principalType: "service" },
        { ...ctx.session.auth.current, authenticator: "leaderboard" },
        { ...ctx.session.auth.current, attributes: { guild_id: "456/members/123" } },
    ]) {
        await assert.rejects(nicknameTool.execute({ nickname: "Name" }, { ...ctx, session: { auth: { current: caller } } }), /only be changed/);
    }
    assert.equal(requests.length, 0);
});

test("can clear only its own server nickname", async () => {
    await nicknameTool.execute(nicknameTool.inputSchema.parse({ nickname: null }), ctx);
    assert.deepEqual(JSON.parse(requests[0].options.body), { nick: null });
    assert(requests[0].url.endsWith("/members/@me"));
});

test("permission and rate limit failures do not claim success", async () => {
    status = 403;
    await assert.rejects(nicknameTool.execute({ nickname: "Name" }, ctx), /Change Nickname permission/);
    status = 429;
    await assert.rejects(nicknameTool.execute({ nickname: "Name" }, ctx), /rate-limited/);
});
