import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch (error) { if (s.startsWith(".") && !/\.[a-z]+$/i.test(s)) return next(`${s}.ts`,c); throw error; } } });
const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid"; process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
const { fxSteering, startFxSteering } = await import("../agent/lib/coding/fx-steering.ts");
const caller = { authenticator: "discord-interaction", principalType: "user", attributes: { user_id: "400", guild_id: "200", ambient: "false" } };
let roles;
beforeEach(() => {
    process.env.DISCORD_GUILD_ID = "200"; process.env.DISCORD_BOT_TOKEN = "test-only"; process.env.DISCORD_API_URL = "https://discord.invalid"; roles = ["600"];
    globalThis.fetch = async (url, options) => {
        if (String(url).startsWith("https://discord.invalid")) return Response.json({ user: { id: "400" }, roles });
        if (String(url).startsWith("https://redis.invalid")) {
            const command = JSON.parse(options.body);
            const reply = () => ({ result: { roles: ["600"], repositories: ["ssta/ascent"], users: {} } });
            return Response.json(String(url).endsWith("/pipeline") ? command.map(reply) : reply());
        }
        throw new Error(`Unexpected fetch: ${url}`);
    };
});
after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

function fixture() {
    const values = new Map(), lists = new Map(), seen = new Map();
    const store = {
        get: async key => values.get(key) ?? null,
        eval: async (script, keys, args) => {
            const active = values.get(keys[0]);
            if (script.includes("fx-mailbox-register")) { if (active && active.id !== args[0]) return 0; values.set(keys[0], JSON.parse(args[1])); return 1; }
            if (script.includes("fx-mailbox-enqueue")) {
                if (!active || active.id !== args[0]) return 0;
                const ids = seen.get(keys[2]) ?? new Set(), list = lists.get(keys[1]) ?? [];
                if (ids.has(args[1])) return 2; if (list.length >= 100) return -1;
                ids.add(args[1]); list.push({ sequence: list.length + 1, id: args[1], userId: args[2], instruction: args[3] });
                seen.set(keys[2], ids); lists.set(keys[1], list); return 1;
            }
            if (script.includes("fx-mailbox-poll")) return active?.id === args[0] ? (lists.get(keys[1]) ?? []).slice(Number(args[1])) : null;
            if (script.includes("fx-mailbox-finish")) { if (active?.id !== args[0]) return -1; if ((lists.get(keys[1]) ?? []).length > args[1]) return 0; values.delete(keys[0]); return 1; }
            if (script.includes("fx-mailbox-release")) { if (active?.id === args[0]) values.delete(keys[0]); return 1; }
            throw new Error("Unexpected script");
        },
    };
    return { mailbox: fxSteering(store, "test"), values };
}
const active = { id: "fx-run", repository: "ssta/ascent", userId: "400" };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("steering is scoped to the active session, ordered, and retry-idempotent", async () => {
    const { mailbox } = fixture();
    await mailbox.register("channel-session", active);
    assert.equal((await mailbox.enqueue("other-session", caller, "Wrong conversation", "wrong")).queued, false);
    assert.equal((await mailbox.enqueue("channel-session", caller, "Use blue", "message-1")).queued, true);
    assert.equal((await mailbox.enqueue("channel-session", caller, "Use blue", "message-1")).duplicate, true);
    await mailbox.enqueue("channel-session", caller, "Also fix tests", "message-2");
    assert.deepEqual((await mailbox.pending("channel-session", active.id, 0)).map(item => item.instruction), ["Use blue", "Also fix tests"]);
    assert.equal((await mailbox.pending("channel-session", active.id, 1)).length, 1);
    await assert.rejects(mailbox.register("channel-session", { ...active, id: "another-writer" }), /already working/);
});

test("corrections require current repo access and only the requester can use an ambient follow-up", async () => {
    const { mailbox } = fixture(); await mailbox.register("s", active);
    const ambient = { ...caller, attributes: { ...caller.attributes, ambient: "true" } };
    assert.equal((await mailbox.enqueue("s", ambient, "Correction from original requester", "a")).queued, true);
    await assert.rejects(mailbox.enqueue("s", { ...ambient, attributes: { ...ambient.attributes, user_id: "401" } }, "Other ambient chatter", "b"), /direct request/);
    await assert.rejects(mailbox.enqueue("s", { ...caller, attributes: { ...caller.attributes, scheduled_task: "true" } }, "Background edit", "c"), /Scheduled work/);
    roles = [];
    await assert.rejects(mailbox.enqueue("s", caller, "After revocation", "d"), /don't have coding access/);
    assert.equal((await mailbox.pending("s", active.id, 0)).length, 1);
});

test("completion cannot discard a concurrently queued correction or release another writer", async () => {
    const { mailbox } = fixture(); await mailbox.register("s", active);
    await mailbox.enqueue("s", caller, "Correction at completion", "late");
    assert.equal(await mailbox.finish("s", active.id, 0), false);
    await mailbox.release("s", "wrong-writer");
    assert.equal((await mailbox.pending("s", active.id, 0)).length, 1);
    assert.equal(await mailbox.finish("s", active.id, 1), true);
    assert.equal((await mailbox.enqueue("s", caller, "After completion", "new")).queued, false);
});

test("live fx receives steering promptly and preserves the cursor across checkpoints", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { mailbox } = fixture(); await mailbox.register("s", active);
    await mailbox.enqueue("s", caller, "Use blue instead", "first");
    const delivered = [], errors = [];
    const pump = startFxSteering({ mailbox, eveSessionId: "s", runId: active.id, cursor: 0,
        session: { hasUnfinishedTurn: () => true, experimental_steerTurn: async text => { delivered.push(text); } }, isSuspending: () => false, onError: error => errors.push(error) });
    await flush(); assert.match(delivered[0], /Use blue instead/); assert.equal(pump.cursor(), 1);
    await mailbox.enqueue("s", caller, "And keep the old layout", "second"); t.mock.timers.tick(2000); await flush();
    await pump.stop(); assert.equal(delivered.length, 2); assert.equal(pump.cursor(), 2); assert.deepEqual(errors, []);
    assert.deepEqual(await mailbox.pending("s", active.id, pump.cursor()), []);
});

test("a correction racing with fx suspension stays unread for the next slice", async () => {
    const { mailbox } = fixture(); await mailbox.register("s", active); await mailbox.enqueue("s", caller, "Late correction", "late");
    const errors = [];
    const pump = startFxSteering({ mailbox, eveSessionId: "s", runId: active.id, cursor: 0,
        session: { hasUnfinishedTurn: () => true, experimental_steerTurn: async () => { throw new Error("Harness session fx-run has no running turn to steer."); } }, isSuspending: () => false, onError: e => errors.push(e) });
    await flush(); await pump.stop(); assert.equal(pump.cursor(), 0); assert.deepEqual(errors, []);
    assert.equal(await mailbox.finish("s", active.id, 0), false);
    assert.equal((await mailbox.pending("s", active.id, 0)).length, 1);
});

test("lost steering ownership reports an error rather than silently running another writer", async () => {
    const { mailbox, values } = fixture(); await mailbox.register("s", active); values.clear();
    const errors = [];
    const pump = startFxSteering({ mailbox, eveSessionId: "s", runId: active.id, cursor: 0,
        session: { hasUnfinishedTurn: () => true, experimental_steerTurn: async () => assert.fail() }, isSuspending: () => false, onError: e => errors.push(e) });
    await flush(); await pump.stop(); assert.match(errors[0].message, /Lost the fx steering lease/);
});
