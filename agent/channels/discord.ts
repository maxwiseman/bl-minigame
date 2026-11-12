import { defaultDiscordAuth, defaultDiscordMessageAuth, discordChannel } from "eve/channels/discord";
import { memberContext, takeCooldown } from "../lib/discord-members";

// Keep replies in the channel, as /ask and announcements have always been.
export default discordChannel({
    turnPolicy: "queue",
    async onCommand(ctx, interaction) {
        if (interaction.commandName !== "ask") return null;
        if (!(await takeCooldown(interaction.user.id))) {
            await ctx.discord.post("Slow down! Try again in a few seconds 🚀");
            return null;
        }
        return {
            auth: defaultDiscordAuth(interaction),
            context: [
                ...await memberContext(interaction.user, interaction.guildId, interaction.member),
                "Quote the asker's question with a Discord blockquote before your answer, since Discord hides the /ask question. Do not ping mentions in the quote.",
            ],
        };
    },
    onAnswers: (_ctx, interaction) => ({ auth: defaultDiscordAuth(interaction) }),
    gateway: {
        startThread: false,
        async onMessage(ctx, message) {
            if (!message.addressed) return null;
            if (!(await takeCooldown(message.author.id))) {
                await ctx.discord.post("Slow down! Try again in a few seconds 🚀");
                return null;
            }
            const member = message.raw.member as { nick?: string; roles?: string[] } | undefined;
            return {
                auth: defaultDiscordMessageAuth(message),
                context: await memberContext(message.author, message.guildId, member),
            };
        },
    },
});
