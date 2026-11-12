import { runDiscordGatewayRelay } from "eve/experimental/channels/discord/gateway";

// One relay per bot. Vercel OIDC authenticates it to the agent in the same project.
// Ambient channels require the privileged Message Content intent in Discord.
await runDiscordGatewayRelay({
    messageContent: process.env.DISCORD_MESSAGE_CONTENT === "true"
        || Boolean(process.env.DISCORD_AMBIENT_CHANNEL_IDS?.split(",").some((id) => id.trim())),
    url: process.env.EVE_URL,
});
