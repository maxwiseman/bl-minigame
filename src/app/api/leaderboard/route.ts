import { after, connection, type NextRequest } from "next/server";

import { announceHighScore } from "@/discord/announce";
import { cleanName, validScore } from "@/game/leaderboard";
import { NAMES_KEY, redis, SCORES_KEY, topEntries } from "@/leaderboard-db";

/* Entries kept beyond what's shown, so the board doesn't empty out if some get cleaned up */
const KEEP = 100;
const SUBMITS_PER_MINUTE = 5;

export async function GET() {
    // Always live, never prerendered
    await connection();
    return Response.json({ entries: await topEntries() });
}

export async function POST(request: NextRequest) {
    const body: unknown = await request.json().catch(() => null);
    const { name: rawName, score } = (body ?? {}) as { name?: unknown; score?: unknown };
    const name = cleanName(rawName);
    if (!name || !validScore(score)) return Response.json({ error: "Invalid name or score" }, { status: 400 });

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limitKey = `leaderboard:limit:${ip}`;
    const submits = await redis.incr(limitKey);
    if (submits == 1) await redis.expire(limitKey, 60);
    if (submits > SUBMITS_PER_MINUTE) return Response.json({ error: "Too many submissions" }, { status: 429 });

    const previous = (await topEntries())[0] ?? null;
    const id = crypto.randomUUID();
    await redis.hset(NAMES_KEY, { [id]: name });
    await redis.zadd(SCORES_KEY, { score, member: id });

    // Drop everything below the kept range, names included
    const dropped = await redis.zrange<string[]>(SCORES_KEY, 0, -(KEEP + 1));
    if (dropped.length > 0) {
        await redis.zrem(SCORES_KEY, ...dropped);
        await redis.hdel(NAMES_KEY, ...dropped);
    }

    // New #1: tell Discord once the game has its response
    if (!previous || score > previous.score) after(() => announceHighScore({ name, score, previous }));

    return Response.json({ entries: await topEntries() });
}
