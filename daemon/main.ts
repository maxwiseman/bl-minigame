import { pathToFileURL } from "node:url";
import { DiscordGatewayFatalError, runDiscordGatewayRelay } from "eve/experimental/channels/discord/gateway";

export async function startRelay(runRelay = runDiscordGatewayRelay, env = process.env): Promise<void> {
    const messageContent = env.DISCORD_MESSAGE_CONTENT === "true"
        || Boolean(env.DISCORD_AMBIENT_CHANNEL_IDS?.split(",").some((id) => id.trim()));
    const options = { messageContent, url: env.EVE_URL };
    try {
        await runRelay(options);
    } catch (error) {
        if (!messageContent || !(error instanceof DiscordGatewayFatalError) || !/\b4014\b/.test(error.message)) throw error;
        console.error(
            "Discord denied Message Content Intent (4014). Continuing with mentions and DMs only. " +
            "Enable Message Content Intent under Bot in the Discord Developer Portal, then restart the daemon to restore ambient listening.",
        );
        await runRelay({ ...options, messageContent: false });
    }
}

// One relay per bot. Importing this module in tests never opens a Gateway connection.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startRelay();
