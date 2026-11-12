import { getVercelOidcToken } from "@vercel/oidc";
import type { LeaderboardEntry } from "./game/leaderboard";

/** Notify the Eve agent; its Discord channel handles generation and delivery. */
export async function announceScore(event: { id: string; name: string; score: number; before: LeaderboardEntry[] }, origin: string): Promise<void> {
    const baseUrl = process.env.EVE_URL
        ?? (process.env.VERCEL && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : origin);
    try {
        const headers = new Headers({ "Content-Type": "application/json" });
        if (process.env.VERCEL) {
            const token = await getVercelOidcToken();
            headers.set("Authorization", `Bearer ${token}`);
            headers.set("x-vercel-trusted-oidc-idp-token", token);
        }
        const response = await fetch(new URL("/eve/v1/leaderboard", baseUrl), {
            method: "POST",
            headers,
            body: JSON.stringify(event),
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Eve rejected the score event: ${response.status}`);
    } catch (error) {
        console.error("Leaderboard announcement failed", error);
    }
}
