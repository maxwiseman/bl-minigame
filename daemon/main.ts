import { pathToFileURL } from "node:url";
import { getVercelOidcToken } from "@vercel/oidc";
import { DiscordGatewayFatalError, runDiscordGatewayRelay } from "eve/experimental/channels/discord/gateway";
export { DiscordGatewayFatalError };

export async function startRelay(runRelay = runDiscordGatewayRelay, env = process.env): Promise<void> {
    const messageContent = env.DISCORD_MESSAGE_CONTENT === "true"
        || Boolean(env.DISCORD_AMBIENT_CHANNEL_IDS?.split(",").some((id) => id.trim()));
    const options = {
        messageContent, url: env.EVE_URL,
        // Eve rc.10 bundles @vercel/oidc 3.8, which ignores Daemons' rotating
        // token file. Use the file-aware SDK on every request; never cache a token.
        ...(env.VERCEL === "1" || env.VERCEL_OIDC_TOKEN_FILE || env.VERCEL_OIDC_TOKEN ? {
            auth: async () => {
                const token = await getVercelOidcToken();
                return { headers: {
                    authorization: `Bearer ${token}`,
                    "x-vercel-trusted-oidc-idp-token": token,
                } };
            },
        } : {}),
    };
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
