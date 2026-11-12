import { z } from "zod";

const memberSchema = z.object({
    nick: z.string().nullable().optional(),
    user: z.object({ id: z.string(), username: z.string(), global_name: z.string().nullable().optional() }),
});

const identities = new Map<string, { expiresAt: number; identity: BotIdentity }>();
type BotIdentity = {
    id: string;
    username: string;
    nickname: string | null;
    displayName: string;
};

export function invalidateBotIdentity(guildId: string) {
    identities.delete(guildId);
}

/** Guild nicknames can change externally too, so never cache them for more than 30 seconds. */
export async function botIdentity(guildId: string | undefined, botUserId: string | undefined): Promise<BotIdentity | undefined> {
    if (!guildId || !botUserId || !/^\d+$/.test(guildId) || !/^\d+$/.test(botUserId)) return;
    const cached = identities.get(guildId);
    if (cached && cached.identity.id === botUserId && cached.expiresAt > Date.now()) return cached.identity;
    try {
        const api = process.env.DISCORD_API_URL ?? "https://discord.com/api/v10";
        const response = await fetch(`${api}/guilds/${guildId}/members/${botUserId}`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
            signal: AbortSignal.timeout(2_000), redirect: "error",
        });
        if (!response.ok) return;
        const member = memberSchema.parse(await response.json());
        if (member.user.id !== botUserId) return;
        const identity = {
            id: botUserId, username: member.user.username, nickname: member.nick ?? null,
            displayName: member.nick || member.user.global_name || member.user.username,
        };
        if (identities.size >= 100) identities.delete(identities.keys().next().value!);
        identities.set(guildId, { identity, expiresAt: Date.now() + 30_000 });
        return identity;
    } catch {
        // Nickname lookup failure must not prevent normal ambient screening.
        return;
    }
}
