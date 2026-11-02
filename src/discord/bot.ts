import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat, type StateAdapter } from "chat";

/* State key for the bot's past announcements, which the model reads back for context */
const ANNOUNCEMENTS_KEY = "announcements";
/* How many past announcements the model sees */
const ANNOUNCEMENTS_KEPT = 10;

/**
 * An announcement the bot posted, with the facts it was written from
 */
export interface Announcement {
    facts: string;
    text: string;
}

let bot: { chat: Chat; state: StateAdapter } | null = null;

/**
 * Discord channel the bot announces in, or null when Discord isn't configured
 */
export function announcementChannelId(): string | null {
    const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID } =
        process.env;
    if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID || !DISCORD_PUBLIC_KEY || !DISCORD_GUILD_ID || !DISCORD_CHANNEL_ID) {
        return null;
    }
    return `discord:${DISCORD_GUILD_ID}:${DISCORD_CHANNEL_ID}`;
}

async function getBot() {
    if (!bot) {
        // Redis (REDIS_URL, from Upstash) keeps the announcement log between requests; memory is fine locally
        const state = process.env.REDIS_URL ? createRedisState() : createMemoryState();
        // Credentials come from DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID and DISCORD_PUBLIC_KEY
        const chat = new Chat({
            userName: "Big Liquid Game",
            adapters: { discord: createDiscordAdapter() },
            state,
        });
        bot = { chat, state };
    }
    await bot.chat.initialize();
    return bot;
}

/**
 * Past announcements, oldest first
 */
export async function recentAnnouncements(): Promise<Announcement[]> {
    const { state } = await getBot();
    return state.getList<Announcement>(ANNOUNCEMENTS_KEY);
}

/**
 * Post a message to the announcement channel and add it to the log
 */
export async function postAnnouncement(announcement: Announcement): Promise<void> {
    const channelId = announcementChannelId();
    if (!channelId) return;
    const { chat, state } = await getBot();
    await chat.channel(channelId).post(announcement.text);
    await state.appendToList(ANNOUNCEMENTS_KEY, announcement, { maxLength: ANNOUNCEMENTS_KEPT });
}
