import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";

let bot: Chat | null = null;

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

/**
 * Post a message to the announcement channel. The bot only ever posts, so in-memory state is enough.
 */
export async function postAnnouncement(text: string): Promise<void> {
    const channelId = announcementChannelId();
    if (!channelId) return;
    // Credentials come from DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID and DISCORD_PUBLIC_KEY
    bot ??= new Chat({
        userName: "Big Liquid",
        adapters: { discord: createDiscordAdapter() },
        state: createMemoryState(),
    });
    await bot.channel(channelId).post(text);
}
