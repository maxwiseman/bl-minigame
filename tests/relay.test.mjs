import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscordGatewayFatalError } from "eve/experimental/channels/discord/gateway";
import { startRelay } from "../daemon/main.ts";

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
