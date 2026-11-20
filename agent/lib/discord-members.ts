import type { DiscordUser } from "eve/channels/discord";
import { getRedis } from "./redis";
import { z } from "zod";

const serverMember = z.object({
    user: z.object({ id: z.string() }),
    nick: z.string().nullable().optional(),
    roles: z.array(z.string()),
});

/** Verify every DM against Discord so leaving the server revokes shared-memory access. */
export async function directMessageMember(userId: string) {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || !/^\d+$/.test(guildId) || !/^\d+$/.test(userId) || !process.env.DISCORD_BOT_TOKEN) {
        throw new Error("DMs aren't configured yet. Please contact the bot's maintainer.");
    }
    const api = process.env.DISCORD_API_URL ?? "https://discord.com/api/v10";
    const response = await fetch(`${api}/guilds/${guildId}/members/${userId}`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(3_000), redirect: "error",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Membership lookup failed (${response.status}).`);
    const member = serverMember.parse(await response.json());
    if (member.user.id !== userId) throw new Error("Membership lookup returned the wrong user.");
    return { guildId, member: { nick: member.nick ?? undefined, roles: member.roles } };
}

async function roleNames(guildId: string, roleIds: readonly string[]): Promise<string[]> {
    if (roleIds.length == 0) return [];
    try {
        const api = process.env.DISCORD_API_URL ?? "https://discord.com/api/v10";
        const response = await fetch(`${api}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
            signal: AbortSignal.timeout(2_000), redirect: "error",
        });
        if (!response.ok) throw new Error(`Discord said ${response.status}`);
        const roles = (await response.json()) as { id: string; name: string; position: number }[];
        return roles
            .filter((role) => roleIds.includes(role.id))
            .sort((a, b) => b.position - a.position)
            .map((role) => role.name);
    } catch (error) {
        console.error("Discord bot: couldn't look up roles", error);
        return [];
    }
}


export async function takeCooldown(userId: string): Promise<boolean> {
    return (await getRedis().set(`bl-agent:cooldown:${userId}`, true, { nx: true, px: 2_000 })) === "OK";
}

export async function memberContext(
    user: DiscordUser,
    guildId?: string,
    member?: { nick?: string; roles?: readonly string[] },
): Promise<string[]> {
    const name = member?.nick || user.globalName || user.username;
    const roles = guildId ? await roleNames(guildId, member?.roles ?? []) : [];
    return [`Speaker: ${name}${roles.length ? ` (Discord roles: ${roles.join(", ")})` : ""}; Discord user ID: ${user.id}`];
}
