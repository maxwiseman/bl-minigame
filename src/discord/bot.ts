import { createDiscordAdapter, type DiscordAdapter } from "@chat-adapter/discord";
import { Chat } from "chat";

import { answerAsk } from "./reply";
import { getState } from "./state";

type Bot = Chat<{ discord: DiscordAdapter }>;

let bot: Promise<Bot> | null = null;

/**
 * Whether the Discord app credentials are set
 */
export function discordConfigured(): boolean {
    const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY } = process.env;
    return Boolean(DISCORD_BOT_TOKEN && DISCORD_APPLICATION_ID && DISCORD_PUBLIC_KEY);
}

/**
 * Discord channel the bot announces in, or null when Discord isn't configured
 */
export function announcementChannelId(): string | null {
    const { DISCORD_GUILD_ID, DISCORD_CHANNEL_ID } = process.env;
    if (!discordConfigured() || !DISCORD_GUILD_ID || !DISCORD_CHANNEL_ID) return null;
    return `discord:${DISCORD_GUILD_ID}:${DISCORD_CHANNEL_ID}`;
}

/**
 * The bot, set up to answer /ask. Credentials come from DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID and
 * DISCORD_PUBLIC_KEY.
 */
export async function getBot(): Promise<Bot> {
    // One shared setup, so requests arriving together don't each register the handler
    bot ??= (async () => {
        const chat: Bot = new Chat({
            userName: "Big Liquid Game",
            adapters: { discord: createDiscordAdapter() },
            state: await getState(),
        });
        chat.onSlashCommand("/ask", answerAsk);
        await chat.initialize();
        return chat;
    })();
    return bot;
}
