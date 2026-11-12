import { runDiscordGatewayRelay } from "eve/experimental/channels/discord/gateway";

// One relay per bot. Vercel OIDC authenticates it to the agent in the same project.
// Mentions work without Discord's privileged Message Content intent.
await runDiscordGatewayRelay({
    messageContent: process.env.DISCORD_MESSAGE_CONTENT === "true",
    url: process.env.EVE_URL,
});
