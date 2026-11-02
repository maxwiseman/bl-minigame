import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import type { StateAdapter } from "chat";

let state: StateAdapter | null = null;

/**
 * The bot's Chat SDK state: Redis (REDIS_URL, from Upstash) so it survives between requests, in-memory locally
 */
export async function getState(): Promise<StateAdapter> {
    state ??= process.env.REDIS_URL ? createRedisState() : createMemoryState();
    await state.connect();
    return state;
}
