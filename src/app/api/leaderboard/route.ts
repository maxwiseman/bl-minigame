import { Redis } from "@upstash/redis";
import { connection, type NextRequest } from "next/server";

import { cleanName, LEADERBOARD_SIZE, LeaderboardEntry, validScore } from "@/game/leaderboard";

/* Sorted set of entry ids by score, with names kept in a hash */
const SCORES_KEY = "leaderboard:scores";
const NAMES_KEY = "leaderboard:names";
/* Entries kept beyond what's shown, so the board doesn't empty out if some get cleaned up */
const KEEP = 100;
const SUBMITS_PER_MINUTE = 5;

const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

async function topEntries(): Promise<LeaderboardEntry[]> {
    const ranked = await redis.zrange<string[]>(SCORES_KEY, 0, LEADERBOARD_SIZE - 1, { rev: true, withScores: true });
    const ids: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i < ranked.length; i += 2) {
        ids.push(String(ranked[i]));
        scores.push(Number(ranked[i + 1]));
    }
    if (ids.length == 0) return [];
    const names = await redis.hmget<Record<string, string>>(NAMES_KEY, ...ids);
    return ids.map((id, i) => ({ name: String(names?.[id] ?? "???"), score: scores[i]! }));
}

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

    const id = crypto.randomUUID();
    await redis.hset(NAMES_KEY, { [id]: name });
    await redis.zadd(SCORES_KEY, { score, member: id });

    // Drop everything below the kept range, names included
    const dropped = await redis.zrange<string[]>(SCORES_KEY, 0, -(KEEP + 1));
    if (dropped.length > 0) {
        await redis.zrem(SCORES_KEY, ...dropped);
        await redis.hdel(NAMES_KEY, ...dropped);
    }

    return Response.json({ entries: await topEntries() });
}
