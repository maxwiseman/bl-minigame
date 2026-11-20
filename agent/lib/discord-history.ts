import { z } from "zod";
import type { Caller } from "./coding/access";
import { channelSchema, discordId, discordJson, discordResponse, publicHistoryChannels } from "./discord-access";

const messageSchema = z.object({
    id: discordId, channel_id: discordId, content: z.string(), timestamp: z.string(),
    author: z.object({ id: discordId, username: z.string(), global_name: z.string().nullable().optional(), bot: z.boolean().optional() }),
    attachments: z.array(z.object({ filename: z.string() })).default([]),
});
function present(message: z.infer<typeof messageSchema>, guildId: string) {
    return { id: message.id, channelId: message.channel_id, authorId: message.author.id,
        author: message.author.global_name ?? message.author.username, bot: message.author.bot ?? false,
        text: message.content, timestamp: message.timestamp, attachments: message.attachments.map(file => file.filename),
        permalink: `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}` };
}
export const searchInput = z.object({
    query: z.string().trim().min(1).max(1024), channelIds: z.array(discordId).min(1).max(20).optional(),
    authorId: discordId.optional(), before: discordId.optional(), after: discordId.optional(),
    limit: z.number().int().min(1).max(25).default(10), offset: z.number().int().min(0).max(9975).default(0),
}).strict();
export async function searchDiscord(input: z.infer<typeof searchInput>, caller: Caller | null | undefined, signal?: AbortSignal) {
    const access = await publicHistoryChannels(caller, signal);
    const available = new Set(access.channels.map(channel => channel.id));
    const ids = input.channelIds ?? [...available];
    if (ids.some(id => !available.has(id))) throw new Error("History search only reads public channels accessible to the requester.");
    if (!ids.length) return { unavailable: true, message: "No public channels with readable history are available." };
    if (ids.length > 500) throw new Error("Select specific channel IDs to narrow this search.");
    const params = new URLSearchParams({ content: input.query, limit: String(input.limit), offset: String(input.offset), sort_by: "relevance" });
    ids.forEach(id => params.append("channel_id", id));
    if (input.authorId) params.append("author_id", input.authorId);
    if (input.before) params.set("max_id", input.before);
    if (input.after) params.set("min_id", input.after);
    const response = await discordResponse(`/guilds/${access.guildId}/messages/search?${params}`, { signal });
    if (response.status === 202) return { unavailable: true, message: "Discord is still indexing this server. Retry later; this is not an empty search." };
    if (!response.ok) throw new Error(`Discord search failed (${response.status}). Check Read Message History and Message Content Intent; do not report this as no matches.`);
    const data = z.object({ total_results: z.number(), messages: z.array(z.array(messageSchema)), doing_deep_historical_index: z.boolean().optional(), threads: z.array(channelSchema).default([]) }).parse(await response.json());
    const selected = new Set(ids);
    // Search may return messages in public threads beneath a selected public parent.
    for (const thread of data.threads) {
        if ([10, 11].includes(thread.type) && !thread.nsfw && (!thread.guild_id || thread.guild_id === access.guildId)
            && thread.parent_id && selected.has(thread.parent_id)) selected.add(thread.id);
    }
    const matches = data.messages.flat().filter(message => selected.has(message.channel_id)).map(message => present(message, access.guildId));
    return { matches, totalResults: data.total_results, indexing: data.doing_deep_historical_index ?? false,
        nextOffset: input.offset + input.limit < Math.min(data.total_results, 10000) ? input.offset + input.limit : undefined };
}
export const readInput = z.object({ channelId: discordId, before: discordId.optional(), around: discordId.optional(), limit: z.number().int().min(1).max(100).default(30) })
    .strict().refine(input => !(input.before && input.around), "Choose before or around, not both.");
export async function readDiscord(input: z.infer<typeof readInput>, caller: Caller | null | undefined, signal?: AbortSignal) {
    const access = await publicHistoryChannels(caller, signal);
    let channel = access.channels.find(channel => channel.id === input.channelId);
    if (!channel) {
        const thread = channelSchema.parse(await discordJson(`/channels/${input.channelId}`, signal));
        if (thread.guild_id !== access.guildId || ![10, 11].includes(thread.type) || !access.channels.some(parent => parent.id === thread.parent_id)) {
            throw new Error("History reads only public channels and public threads accessible to the requester.");
        }
        channel = thread;
    }
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.before) params.set("before", input.before);
    if (input.around) params.set("around", input.around);
    const messages = z.array(messageSchema).parse(await discordJson(`/channels/${input.channelId}/messages?${params}`, signal));
    if (messages.some(message => message.channel_id !== input.channelId)) throw new Error("Discord returned history from another channel.");
    return { channelId: channel.id, channelName: channel.name, messages: [...messages].sort((a,b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1).map(message => present(message, access.guildId)),
        nextBefore: messages.length === input.limit ? messages.reduce((oldest, message) => BigInt(message.id) < BigInt(oldest) ? message.id : oldest, messages[0]!.id) : undefined };
}
