import { z } from "zod";
import { authorizeChanges, codingPrefix, type Caller } from "./access";
import { getRedis } from "../redis";

export const steeringInput = z.object({ instruction: z.string().trim().min(1).max(8000) }).strict();
const activeSchema = z.object({ id: z.string(), repository: z.string(), userId: z.string() });
const correctionSchema = z.object({ sequence: z.number().int().positive(), id: z.string(), userId: z.string(), instruction: z.string() });
export type ActiveFx = z.infer<typeof activeSchema>;
export type FxCorrection = z.infer<typeof correctionSchema>;
export interface SteeringStore {
    get<T>(key: string): Promise<T | null>;
    eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

const REGISTER = `-- fx-mailbox-register
local old = redis.call('GET', KEYS[1])
if old and cjson.decode(old).id ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', 180)
return 1`;
const ENQUEUE = `-- fx-mailbox-enqueue
local active = redis.call('GET', KEYS[1])
if not active or cjson.decode(active).id ~= ARGV[1] then return 0 end
if redis.call('SISMEMBER', KEYS[3], ARGV[2]) == 1 then return 2 end
local count = redis.call('LLEN', KEYS[2])
if count >= 100 then return -1 end
redis.call('SADD', KEYS[3], ARGV[2])
redis.call('RPUSH', KEYS[2], cjson.encode({sequence=count+1,id=ARGV[2],userId=ARGV[3],instruction=ARGV[4]}))
redis.call('EXPIRE', KEYS[2], 604800)
redis.call('EXPIRE', KEYS[3], 604800)
return 1`;
const POLL = `-- fx-mailbox-poll
local active = redis.call('GET', KEYS[1])
if not active or cjson.decode(active).id ~= ARGV[1] then return false end
redis.call('EXPIRE', KEYS[1], 180)
return redis.call('LRANGE', KEYS[2], ARGV[2], -1)`;
const FINISH = `-- fx-mailbox-finish
local active = redis.call('GET', KEYS[1])
if not active or cjson.decode(active).id ~= ARGV[1] then return -1 end
if redis.call('LLEN', KEYS[2]) > tonumber(ARGV[2]) then return 0 end
redis.call('DEL', KEYS[1])
return 1`;
const RELEASE = `-- fx-mailbox-release
local active = redis.call('GET', KEYS[1])
if active and cjson.decode(active).id == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1`;

/** Cross-invocation inbox. Sequence advances only after fx accepts a correction. */
export function fxSteering(store: SteeringStore = getRedis(), prefix = codingPrefix()) {
    const activeKey = (sessionId: string) => `${prefix}:fx-active:${sessionId}`;
    const inboxKey = (runId: string) => `${prefix}:fx-steering:${runId}`;
    return {
        async register(sessionId: string, active: ActiveFx) {
            if (await store.eval(REGISTER, [activeKey(sessionId)], [active.id, JSON.stringify(active)]) !== 1) {
                throw new Error("fx is already working in this session. Use steer_fx to correct it, or wait/cancel before starting another writer.");
            }
        },
        async enqueue(sessionId: string, caller: Caller | null | undefined, instruction: string, id: string) {
            const raw = await store.get(activeKey(sessionId));
            if (!raw) return { queued: false, reason: "No fx task is running in this conversation. Inspect its result or start a follow-up task." };
            const active = activeSchema.parse(raw);
            if (caller?.attributes.scheduled_task === "true") throw new Error("Scheduled work cannot steer an interactive fx task.");
            // An accepted follow-up from the original requester can correct their existing
            // task without a new mention. It still needs fresh membership and repository access.
            const requesterFollowUp = caller?.attributes.user_id === active.userId && caller.attributes.ambient === "true";
            const requester = requesterFollowUp ? { ...caller, attributes: { ...caller.attributes, ambient: "false" } } : caller;
            const { userId } = await authorizeChanges(requester, active.repository);
            const result = await store.eval(ENQUEUE, [activeKey(sessionId), inboxKey(active.id), `${inboxKey(active.id)}:seen`],
                [active.id, id, userId, steeringInput.parse({ instruction }).instruction]);
            if (result === -1) throw new Error("This fx task has reached its 100-correction limit.");
            return { queued: result === 1 || result === 2, duplicate: result === 2, repository: active.repository,
                ...(result === 0 ? { reason: "fx finished or changed before the correction was queued. Check its result before starting follow-up work." } : {}) };
        },
        async pending(sessionId: string, runId: string, cursor: number): Promise<FxCorrection[]> {
            const rows = await store.eval(POLL, [activeKey(sessionId), inboxKey(runId)], [runId, cursor]);
            if (!Array.isArray(rows)) throw new Error("Lost the fx steering lease; stopping this writer to avoid overlapping work.");
            return rows.map(row => correctionSchema.parse(typeof row === "string" ? JSON.parse(row) : row));
        },
        async finish(sessionId: string, runId: string, cursor: number) {
            const result = await store.eval(FINISH, [activeKey(sessionId), inboxKey(runId)], [runId, cursor]);
            if (result === -1) throw new Error("Lost the fx steering lease before completion.");
            return result === 1;
        },
        async release(sessionId: string, runId: string) { await store.eval(RELEASE, [activeKey(sessionId)], [runId]); },
    };
}

export function correctionPrompt(corrections: readonly FxCorrection[]) {
    return corrections.map(item => `User correction ${item.id} (Discord user ${item.userId}):\n${item.instruction}`).join("\n\n");
}

/** Poll the durable inbox while this process owns the live fx turn. */
export function startFxSteering(options: {
    mailbox: ReturnType<typeof fxSteering>; eveSessionId: string; runId: string; cursor: number;
    session: { hasUnfinishedTurn(): boolean; experimental_steerTurn(text: string): Promise<void> };
    isSuspending(): boolean; onError(error: unknown): void;
}) {
    let cursor = options.cursor, stopped = false, busy = false;
    let pending = Promise.resolve();
    const poll = () => {
        if (stopped || busy) return;
        busy = true;
        pending = (async () => {
            const messages = await options.mailbox.pending(options.eveSessionId, options.runId, cursor);
            for (const message of messages) {
                if (stopped || options.isSuspending() || !options.session.hasUnfinishedTurn()) break;
                try { await options.session.experimental_steerTurn(correctionPrompt([message])); }
                catch (error) {
                    // A slice may have just frozen or finished. Leave this correction unread
                    // so the next slice applies it, including a new turn if fx already finished.
                    if (error instanceof Error && error.message.includes("no running turn to steer")) break;
                    throw error;
                }
                cursor = message.sequence;
            }
        })().catch(options.onError).finally(() => { busy = false; });
    };
    const timer = setInterval(poll, 2000);
    poll();
    return { cursor: () => cursor, async stop() { stopped = true; clearInterval(timer); await pending; } };
}
