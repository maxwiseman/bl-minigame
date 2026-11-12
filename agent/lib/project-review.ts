import { randomUUID } from "node:crypto";
import { defaultNamespace } from "eve/memory";
import { z } from "zod";
import { ambientChannelIds } from "./ambient/goals";

const id = z.string().regex(/^\d+$/);
const messageSchema = z.object({
    id, content: z.string(), timestamp: z.string(), edited_timestamp: z.string().nullable(),
    author: z.object({ id, username: z.string(), bot: z.boolean().optional() }),
    webhook_id: z.string().optional(), type: z.number().default(0),
    sticker_items: z.array(z.unknown()).optional(), poll: z.unknown().optional(),
    attachments: z.array(z.object({ filename: z.string() })).default([]),
    referenced_message: z.object({ content: z.string(), author: z.object({ username: z.string(), bot: z.boolean().optional() }) }).nullable().optional(),
});

// Keep progress separate from Eve's memory documents. Prefix environments so a local or preview
// invocation cannot consume production's review progress when sharing a Redis integration.
export function reviewPrefix() {
    const namespace = defaultNamespace({ appRoot: process.cwd(), node: "root", slot: "project-review" });
    return `bl:project-review:${namespace}:${process.env.DISCORD_GUILD_ID}`;
}

export interface ReviewStore {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
    eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

interface ReviewBatch {
    channelId: string;
    guildId: string;
    previous: string | null;
    through: string;
    readCallId: string;
    reviewedAt: string;
    messageCount: number;
}

function configuration() {
    const guildId = id.parse(process.env.DISCORD_GUILD_ID);
    const channels = [...ambientChannelIds()].map(channel => id.parse(channel));
    return { guildId, channels };
}

async function discord(path: string, signal: AbortSignal) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error("Discord bot token is not configured.");
    const response = await fetch(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bot ${token}` }, redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Discord history request failed (${response.status}); review progress was not advanced.`);
    return response.json();
}

export async function readProjectChannels(store: ReviewStore, channelId: string | undefined, readCallId: string, signal: AbortSignal) {
    if (!ambientChannelIds().size) return { disabled: true, channels: [] };
    const { guildId, channels } = configuration();
    if (!channelId) return { channels };
    if (!channels.includes(channelId)) throw new Error("Channel is not enabled for ambient listening.");
    const channel = z.object({ guild_id: id, name: z.string().optional() })
        .parse(await discord(`/channels/${channelId}`, signal));
    if (channel.guild_id !== guildId) throw new Error("Channel does not belong to the configured server.");
    // An empty page never advances progress: Discord also returns [] without history permission.
    // Wrap snowflakes in objects: Upstash auto-deserializes bare numeric strings as JS numbers.
    const cursor = await store.get<{ through: string }>(`${reviewPrefix()}:cursor:${channelId}`);
    const previous = cursor?.through ?? null;
    const since = previous ?? ((BigInt(Date.now() - 7 * 86_400_000 - 1_420_070_400_000) << BigInt(22))).toString();
    const messages = z.array(messageSchema).parse(await discord(`/channels/${channelId}/messages?after=${since}&limit=50`, signal))
        .filter(message => BigInt(message.id) > BigInt(since))
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
    if (messages.some(message => !message.author.bot && !message.webhook_id
        && (message.type === 0 || message.type === 19) && !message.content
        && !message.attachments.length && !message.sticker_items?.length && !message.poll)) {
        throw new Error("Human message content is unavailable. Check Message Content Intent; review progress was not advanced.");
    }
    if (!messages.length) return { channelId, name: channel.name, caughtUp: true, messages: [] };
    // Discord's after pagination selects the next page; process and commit each page before
    // fetching another. A failed or interrupted run simply replays its uncommitted page.
    const reviewId = randomUUID();
    const batch: ReviewBatch = {
        channelId, guildId, previous, through: messages.at(-1)!.id, readCallId,
        reviewedAt: new Date().toISOString(), messageCount: messages.length,
    };
    await store.set(`${reviewPrefix()}:batch:${reviewId}`, batch, { ex: 3600 });
    return {
        reviewId, channelId, name: channel.name, reviewedAt: batch.reviewedAt,
        possiblyMore: messages.length === 50,
        messages: messages.map(message => ({
            id: message.id, author: message.author.username, authorId: message.author.id,
            evidence: !message.author.bot && !message.webhook_id,
            content: message.content, timestamp: message.timestamp, editedAt: message.edited_timestamp,
            source: `https://discord.com/channels/${guildId}/${channelId}/${message.id}`,
            attachmentNames: message.attachments.map(attachment => attachment.filename),
            replyingTo: message.referenced_message ?? undefined,
        })),
    };
}

// Atomic checkpoint: concurrent/retried runs cannot overwrite newer progress. Only metadata is
// retained here; canonical facts live in Eve's project memory, not in another transcript archive.
const COMMIT = `
local current = redis.call('GET', KEYS[1])
if (current or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
redis.call('DEL', KEYS[3])
return 1
`;

type ReviewMessage = { role: string; content: unknown };
export async function completeProjectReview(store: ReviewStore, input: { reviewId: string; summary: string; nothingToLearn?: string }, messages: readonly ReviewMessage[]) {
    const batchKey = `${reviewPrefix()}:batch:${input.reviewId}`;
    const batch = await store.get<ReviewBatch>(batchKey);
    if (!batch) throw new Error("Review batch expired or was already committed; read the channel again.");
    const { guildId, channels } = configuration();
    if (batch.guildId !== guildId || !channels.includes(batch.channelId)) throw new Error("Review channel is no longer enabled.");
    let readSeen = false;
    let saved = false;
    for (const message of messages) {
        if (message.role !== "tool" || !Array.isArray(message.content)) continue;
        for (const part of message.content) {
            if (part.type !== "tool-result") continue;
            if (part.toolCallId === batch.readCallId) readSeen = true;
            if (readSeen && part.toolName === "project__save_memory"
                && part.output?.type !== "error-text" && part.output?.type !== "error-json") saved = true;
        }
    }
    if (!readSeen) throw new Error("The review must be completed in the session that read its messages.");
    if (!saved && !input.nothingToLearn?.trim()) throw new Error("Save useful project memory before completing the review, or explain why there is nothing new to learn.");
    const result = await store.eval(COMMIT, [
        `${reviewPrefix()}:cursor:${batch.channelId}`, `${reviewPrefix()}:last:${batch.channelId}`, batchKey,
    ], [batch.previous ? JSON.stringify({ through: batch.previous }) : "", JSON.stringify({ through: batch.through }), JSON.stringify({
        channelId: batch.channelId, through: batch.through, reviewedAt: batch.reviewedAt,
        completedAt: new Date().toISOString(), messageCount: batch.messageCount,
        summary: input.summary, nothingToLearn: input.nothingToLearn,
    })]);
    if (result !== 1) throw new Error("Another review advanced this channel. Read again before continuing.");
    console.info("Project memory review completed", { channelId: batch.channelId, messageCount: batch.messageCount });
    return { completed: true, channelId: batch.channelId, through: batch.through };
}
