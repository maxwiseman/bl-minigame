import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
    description:
        "Change only your own Discord server nickname when someone asks you to rename yourself. " +
        "Cannot rename other members or change your global username. Use null to clear your server nickname.",
    inputSchema: z.object({
        nickname: z.string().trim().min(1).max(32).nullable().describe("Your new server nickname, or null to clear it."),
    }).strict(),
    async execute({ nickname }, ctx) {
        const caller = ctx.session.auth.current;
        const guildId = caller?.attributes.guild_id;
        if (caller?.authenticator !== "discord-interaction" || caller.principalType !== "user"
            || typeof guildId !== "string" || !/^\d+$/.test(guildId)) {
            throw new Error("Your nickname can only be changed from a conversation with a person in a Discord server, not from DMs or automatic announcements.");
        }
        const token = process.env.DISCORD_BOT_TOKEN;
        if (!token) throw new Error("The Discord bot token is not configured.");
        // @me is the authenticated bot. No caller-supplied user or guild ID is accepted.
        const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
            method: "PATCH",
            headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ nick: nickname }),
            signal: ctx.abortSignal,
            redirect: "error",
        });
        if (response.status === 403) throw new Error("Discord denied the change. The bot needs the Change Nickname permission in this server.");
        if (response.status === 429) throw new Error("Discord rate-limited nickname changes. Wait before trying again.");
        if (!response.ok) throw new Error(`Discord nickname change failed (${response.status}).`);
        return { nickname, changed: true };
    },
});
