import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";

// Node 24 strips TypeScript; match the extensionless imports used by Eve's compiler.
registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
                return nextResolve(`${specifier}.ts`, context);
            }
            throw error;
        }
    },
});

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.AI_GATEWAY_API_KEY = "test-only";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
process.env.DISCORD_API_URL = "https://discord.invalid";

const { ambientChannelIds } = await import("../agent/lib/ambient/goals.ts");
const { skipAmbientMessage, recentChannelContext } = await import("../agent/lib/ambient/filter.ts");
const { onDiscordMessage } = await import("../agent/channels/discord.ts");
const { default: noReply } = await import("../agent/tools/no_reply.ts");

let requests;
let probability;
let failDecision;
let allowCooldown;
let history;
let posts;
const context = { discord: { applicationId: "500", post: async (text) => posts.push(text) } };
const message = {
    id: "300", channelId: "100", guildId: "200", content: "Who's winning at Big Liquid?",
    author: { id: "400", username: "PLAYER", isBot: false },
    attachments: [], addressed: false, raw: {},
};

beforeEach(() => {
    requests = []; posts = []; probability = 0.9; failDecision = false; allowCooldown = true; history = [];
    process.env.DISCORD_AMBIENT_CHANNEL_IDS = "100";
    globalThis.fetch = async (url, options = {}) => {
        const target = String(url);
        requests.push({ url: target, options });
        if (target.includes("/decision-model")) {
            if (failDecision) throw new Error("Decision unavailable");
            return Response.json({ answers: { forAgent: { type: "boolean", probability } } });
        }
        if (target.startsWith("https://discord.invalid/")) return Response.json(history);
        if (target.startsWith("https://redis.invalid")) {
            return Response.json(target.endsWith("/pipeline")
                ? [{ result: allowCooldown ? "OK" : null }]
                : { result: allowCooldown ? "OK" : null });
        }
        throw new Error(`Unexpected request: ${target}`);
    };
});

after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
});

test("allowlist trims whitespace, deduplicates IDs, and defaults to disabled", () => {
    assert.deepEqual([...ambientChannelIds(" 100,200,100, , ")], ["100", "200"]);
    delete process.env.DISCORD_AMBIENT_CHANNEL_IDS;
    assert.equal(ambientChannelIds().size, 0);
});

test("uses the AI SDK decision transport and explicitly selects OpenAI", async () => {
    probability = 0.1;
    assert.equal(await skipAmbientMessage(message, []), true);
    const request = requests.find((entry) => entry.url.includes("/decision-model"));
    assert.equal(new Headers(request.options.headers).get("ai-model-id"), "openai/gpt-6-luna-decisions");
    assert.equal(new Headers(request.options.headers).get("ai-decision-model-specification-version"), "4");
    assert.equal(JSON.parse(request.options.body).questions.forAgent.type, "boolean");
    probability = 0.2;
    assert.equal(await skipAmbientMessage(message, []), false);
    failDecision = true;
    assert.equal(await skipAmbientMessage(message, []), false);
});

test("unlisted channels, bots, and empty messages never call the filter", async () => {
    for (const candidate of [
        { ...message, channelId: "999" },
        { ...message, author: { ...message.author, isBot: true } },
        { ...message, content: " " },
    ]) assert.equal(await onDiscordMessage(context, candidate), null);
    assert.equal(requests.length, 0);
});

test("context is chronological and truncates earlier message text", async () => {
    history = [
        { content: "x".repeat(2500), author: { id: "2", username: "B" } },
        { content: "older", author: { id: "1", username: "A" } },
    ];
    const transcript = await recentChannelContext(message);
    assert.match(transcript[0], /older$/);
    assert.equal(transcript[1].split(": ")[1].length, 2000);
});

test("no_reply ends a turn without a textual answer", () => {
    assert.equal(noReply.endsTurn, true);
});


test("addressed messages bypass screening outside the allowlist", async () => {
    const accepted = await onDiscordMessage(context, { ...message, channelId: "999", addressed: true });
    assert.equal(accepted.auth.attributes.ambient, "false");
    assert.equal(accepted.conversation, undefined);
    assert.equal(requests.some((entry) => entry.url.includes("/decision-model")), false);
});

test("ambient messages receive selective-reply guidance in a shared channel session", async () => {
    const accepted = await onDiscordMessage(context, message);
    assert.equal(accepted.auth.attributes.ambient, "true");
    assert.equal(accepted.conversation, "ambient");
    assert(accepted.context.some((text) => text.includes("no_reply")));
    assert.deepEqual(posts, []);
});

test("screened-out messages never consume a user cooldown", async () => {
    probability = 0.05;
    assert.equal(await onDiscordMessage(context, message), null);
    assert.equal(requests.some((entry) => entry.url.startsWith("https://redis.invalid")), false);
});

test("ambient cooldowns do not post a slowdown message", async () => {
    allowCooldown = false;
    assert.equal(await onDiscordMessage(context, message), null);
    assert.deepEqual(posts, []);
});


test("mentions carry the preceding unanswered question even outside watched channels", async () => {
    history = [{ content: "you got advice on securing our radio comms?", author: { id: "400", username: "PLAYER" } }];
    const accepted = await onDiscordMessage(context, {
        ...message, channelId: "999", addressed: true, content: "I'm talking to you",
    });
    assert(accepted.context.some((text) => text.includes("securing our radio comms")));
    assert.equal(requests.some((entry) => entry.url.includes("/decision-model")), false);
});

test("a follow-up's decision and agent context retain the bot's question at the end of a long reply", async () => {
    const question = "What radios are you using?";
    history = [{ content: `${"Background advice. ".repeat(80)} ${question}`, author: { id: "500", username: "BIG LIQUID BOT", bot: true } }];
    const accepted = await onDiscordMessage(context, { ...message, content: "we're using xbees" });
    const decision = requests.find((entry) => entry.url.includes("/decision-model"));
    const evidence = JSON.stringify(JSON.parse(decision.options.body).stateParts);
    assert(evidence.includes(question));
    assert(evidence.includes("you/the agent"));
    assert(evidence.includes("we're using xbees"));
    assert(accepted.context.some((text) => text.includes(question)));
    assert(accepted.context.some((text) => text.includes("you/the agent")));
});
