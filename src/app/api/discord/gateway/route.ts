import { after } from "next/server";

import { discordConfigured, getBot } from "@/discord/bot";

/* Discord only sends ordinary messages (like @mentions) over its Gateway connection, so a cron job keeps one open:
 * each run listens for 10 minutes and runs every 9, so they overlap */
export const maxDuration = 800;
const LISTEN_MS = 600 * 1000;

export async function GET(request: Request): Promise<Response> {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return new Response("CRON_SECRET not configured", { status: 500 });
    if (request.headers.get("authorization") != `Bearer ${cronSecret}`) {
        return new Response("Unauthorized", { status: 401 });
    }
    if (!discordConfigured()) return new Response("Discord isn't configured", { status: 503 });

    // Events go to the production domain's webhook route, which Deployment Protection doesn't cover
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
    const webhookUrl = `https://${host}/api/webhooks/discord`;

    const bot = await getBot();
    return bot.getAdapter("discord").startGatewayListener(
        { waitUntil: (task) => after(() => task) },
        LISTEN_MS,
        undefined,
        webhookUrl,
    );
}
