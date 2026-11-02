import { after } from "next/server";

import { discordConfigured, getBot } from "@/discord/bot";

/**
 * Discord interactions (the /ask command). Set this as the app's Interactions Endpoint URL; the adapter checks
 * Discord's signature with DISCORD_PUBLIC_KEY.
 */
export async function POST(request: Request): Promise<Response> {
    if (!discordConfigured()) return new Response("Discord isn't configured", { status: 503 });
    const bot = await getBot();
    return bot.webhooks.discord(request, { waitUntil: (task) => after(() => task) });
}
