import { Redis } from "@upstash/redis";

import { LEADERBOARD_SIZE, LeaderboardEntry } from "@/game/leaderboard";

/* Sorted set of entry ids by score, with names kept in a hash */
export const SCORES_KEY = "leaderboard:scores";
export const NAMES_KEY = "leaderboard:names";

export const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

export async function topEntries(): Promise<LeaderboardEntry[]> {
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
