import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscordGatewayFatalError, startRelay } from "../daemon/main.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("denied Message Content intent keeps mentions and DMs online", async () => {
    const calls = [];
    await startRelay(async (options) => {
        calls.push(options);
        if (options.messageContent) throw new DiscordGatewayFatalError("Discord closed the Gateway with 4014 (Disallowed intent)");
    }, { DISCORD_AMBIENT_CHANNEL_IDS: "123", EVE_URL: "https://agent.invalid" });
    assert.deepEqual(calls, [
        { messageContent: true, url: "https://agent.invalid" },
        { messageContent: false, url: "https://agent.invalid" },
    ]);
});

test("invalid credentials remain fatal rather than retrying with different intents", async () => {
    let attempts = 0;
    const error = new DiscordGatewayFatalError("Discord closed the Gateway with 4004 (Authentication failed)");
    await assert.rejects(startRelay(async () => { attempts++; throw error; }, { DISCORD_AMBIENT_CHANNEL_IDS: "123" }), error);
    assert.equal(attempts, 1);
});

test("mention-only relays do not retry a disallowed intent failure", async () => {
    let attempts = 0;
    const error = new DiscordGatewayFatalError("Discord closed the Gateway with 4014 (Disallowed intent)");
    await assert.rejects(startRelay(async () => { attempts++; throw error; }, {}), error);
    assert.equal(attempts, 1);
});

test("relay authenticates with the current rotating token, not a stale environment token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bl-relay-oidc-"));
    const tokenFile = join(directory, "token");
    const previousFile = process.env.VERCEL_OIDC_TOKEN_FILE;
    const previousToken = process.env.VERCEL_OIDC_TOKEN;
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = name => `test.${Buffer.from(JSON.stringify({ exp: expires, sub: name })).toString("base64url")}.signature`;
    try {
        process.env.VERCEL_OIDC_TOKEN_FILE = tokenFile;
        process.env.VERCEL_OIDC_TOKEN = token("stale-environment");
        await writeFile(tokenFile, token("first"));
        await startRelay(async options => {
            const first = await options.auth();
            assert.equal(first.headers.authorization, `Bearer ${token("first")}`);
            await writeFile(tokenFile, token("rotated"));
            const rotated = await options.auth();
            assert.equal(rotated.headers.authorization, `Bearer ${token("rotated")}`);
            assert.equal(rotated.headers["x-vercel-trusted-oidc-idp-token"], token("rotated"));
            await writeFile(tokenFile, "");
            await assert.rejects(options.auth(), /empty/);
        }, { VERCEL_OIDC_TOKEN_FILE: tokenFile });
    } finally {
        if (previousFile === undefined) delete process.env.VERCEL_OIDC_TOKEN_FILE;
        else process.env.VERCEL_OIDC_TOKEN_FILE = previousFile;
        if (previousToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
        else process.env.VERCEL_OIDC_TOKEN = previousToken;
        await rm(directory, { recursive: true, force: true });
    }
});
