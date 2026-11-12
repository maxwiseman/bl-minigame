import type { DiscordUser } from "eve/channels/discord";
import { getRedis } from "./redis";

async function roleNames(guildId: string, roleIds: readonly string[]): Promise<string[]> {
    if (roleIds.length == 0) return [];
    try {
        const api = process.env.DISCORD_API_URL ?? "https://discord.com/api/v10";
        const response = await fetch(`${api}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
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
    return [`Speaker: ${name}${roles.length ? ` (Discord roles: ${roles.join(", ")})` : ""}`];
}
