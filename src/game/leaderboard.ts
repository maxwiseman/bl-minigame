/**
 * Leaderboard rules shared by the game and the API
 */

export interface LeaderboardEntry {
    name: string;
    score: number;
}

/* Rows shown in game */
export const LEADERBOARD_SIZE = 10;
export const NAME_MAX = 10;
/* Everything the pixel font can draw that makes sense in a name, in D-pad cycling order */
export const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. ";
/* Comfortably above anything a real flight scores */
export const SCORE_MAX = 5_000_000;

/**
 * Uppercase and trim a name, returning null if it isn't allowed
 */
export function cleanName(raw: unknown): string | null {
    if (typeof raw != "string") return null;
    const name = raw.toUpperCase().replace(/\s+/g, " ").trim();
    if (name.length == 0 || name.length > NAME_MAX) return null;
    for (const c of name) if (!NAME_CHARS.includes(c)) return null;
    return name;
}

export function validScore(score: unknown): score is number {
    return typeof score == "number" && Number.isInteger(score) && score > 0 && score <= SCORE_MAX;
}

/**
 * Whether a score would make the visible board
 */
export function qualifies(entries: LeaderboardEntry[], score: number): boolean {
    if (score <= 0) return false;
    if (entries.length < LEADERBOARD_SIZE) return true;
    return score > entries[entries.length - 1]!.score;
}
