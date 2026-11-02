import { after } from "next/server";

import { discordConfigured, getBot } from "@/discord/bot";

/**
 * Discord events, forwarded by the Gateway listener (see ../../discord/gateway) and verified by the adapter
 */
export async function POST(request: Request): Promise<Response> {
    if (!discordConfigured()) return new Response("Discord isn't configured", { status: 503 });
    const bot = await getBot();
    return bot.webhooks.discord(request, { waitUntil: (task) => after(() => task) });
}
