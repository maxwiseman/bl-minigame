import { z } from "zod";
import { directMessageMember } from "./discord-members";
import type { Caller } from "./coding/access";

export class DiscordAccessError extends Error {}
export class DiscordApiError extends Error {
    readonly status: number;
    constructor(status: number) { super(`Discord request failed (${status}). Check channel access and bot permissions; retry later for rate limits.`); this.status = status; }
}

export const discordId = z.string().regex(/^\d+$/);
export const channelSchema = z.object({
    id: discordId, guild_id: discordId.optional(), type: z.number(), name: z.string().optional(),
    parent_id: discordId.nullable().optional(), nsfw: z.boolean().optional(),
    recipients: z.array(z.object({ id: discordId })).optional(),
    permission_overwrites: z.array(z.object({ id: discordId, type: z.number(), allow: z.string(), deny: z.string() })).default([]),
});
export type GuildChannel = z.infer<typeof channelSchema>;
export const roleSchema = z.object({ id: discordId, permissions: z.string() });
export type GuildRole = z.infer<typeof roleSchema>;
const VIEW = BigInt(1024), HISTORY = BigInt(65536), ADMIN = BigInt(8);

export function discordIdentity(caller: Caller | null | undefined) {
    const guildId = process.env.DISCORD_GUILD_ID;
    const userId = caller?.attributes.user_id;
    if (caller?.authenticator !== "discord-interaction" || caller.principalType !== "user"
        || typeof userId !== "string" || !/^\d+$/.test(userId) || !guildId
        || (caller.attributes.guild_id ?? caller.attributes.memory_guild_id) !== guildId) return null;
    return { guildId, userId };
}

export async function requireDiscordMember(caller: Caller | null | undefined) {
    const identity = discordIdentity(caller);
    if (!identity) throw new Error("This requires a verified member of the configured Discord server.");
    const member = await directMessageMember(identity.userId);
    if (!member) throw new Error("You are no longer a member of the configured Discord server.");
    return { ...identity, roles: member.member.roles };
}

export async function discordResponse(path: string, init: RequestInit = {}) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error("Discord bot token is not configured.");
    return fetch(`${process.env.DISCORD_API_URL ?? "https://discord.com/api/v10"}${path}`, {
        ...init, headers: { ...init.headers, Authorization: `Bot ${token}` }, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init.signal ? [init.signal] : [])]),
    });
}

export async function discordJson(path: string, signal?: AbortSignal) {
    const response = await discordResponse(path, { signal });
    if (!response.ok) throw new DiscordApiError(response.status);
    return response.json() as Promise<unknown>;
}

/** Discord's everyone, aggregate role, then member overwrite order. */
export function canReadChannel(channel: GuildChannel, guildId: string, roles: readonly GuildRole[], member?: { userId: string; roles: readonly string[] }) {
    const memberRoles = new Set([guildId, ...(member?.roles ?? [])]);
    let permissions = roles.filter(role => memberRoles.has(role.id)).reduce((bits, role) => bits | BigInt(role.permissions), BigInt(0));
    if ((permissions & ADMIN) !== BigInt(0)) return true;
    const everyone = channel.permission_overwrites.find(overwrite => overwrite.id === guildId && overwrite.type === 0);
    if (everyone) permissions = permissions & ~BigInt(everyone.deny) | BigInt(everyone.allow);
    if (member) {
        const overwrites = channel.permission_overwrites.filter(overwrite => overwrite.type === 0 && overwrite.id !== guildId && memberRoles.has(overwrite.id));
        const denied = overwrites.reduce((bits, overwrite) => bits | BigInt(overwrite.deny), BigInt(0));
        const allowed = overwrites.reduce((bits, overwrite) => bits | BigInt(overwrite.allow), BigInt(0));
        permissions = permissions & ~denied | allowed;
        const own = channel.permission_overwrites.find(overwrite => overwrite.type === 1 && overwrite.id === member.userId);
        if (own) permissions = permissions & ~BigInt(own.deny) | BigInt(own.allow);
    }
    return (permissions & (VIEW | HISTORY)) === (VIEW | HISTORY);
}

export async function publicHistoryChannels(caller: Caller | null | undefined, signal?: AbortSignal) {
    const member = await requireDiscordMember(caller);
    const [channels, roles] = await Promise.all([
        discordJson(`/guilds/${member.guildId}/channels`, signal).then(data => z.array(channelSchema).parse(data)),
        discordJson(`/guilds/${member.guildId}/roles`, signal).then(data => z.array(roleSchema).parse(data)),
    ]);
    // Match the template's public-only history policy, even if the bot can read private channels.
    return { ...member, channels: channels.filter(channel => [0, 5].includes(channel.type) && !channel.nsfw
        && canReadChannel(channel, member.guildId, roles) && canReadChannel(channel, member.guildId, roles, member)) };
}

/** Revalidate the fixed destination, including private-channel and private-thread membership. */
export async function authorizedDestination(channelId: string, member: { guildId: string; userId: string; roles: readonly string[] }, signal?: AbortSignal) {
    const channel = channelSchema.parse(await discordJson(`/channels/${discordId.parse(channelId)}`, signal));
    if (channel.type === 1) {
        if (!channel.recipients?.some(user => user.id === member.userId)) throw new DiscordAccessError("That DM does not belong to the requester.");
        return channel;
    }
    if (channel.guild_id !== member.guildId || ![0, 5, 10, 11, 12].includes(channel.type)) throw new DiscordAccessError("Unsupported Discord destination or wrong server.");
    const parent = [10, 11, 12].includes(channel.type)
        ? channelSchema.parse(await discordJson(`/channels/${discordId.parse(channel.parent_id)}`, signal)) : channel;
    if (parent.guild_id !== member.guildId) throw new DiscordAccessError("Thread belongs to another server.");
    const roles = z.array(roleSchema).parse(await discordJson(`/guilds/${member.guildId}/roles`, signal));
    if (!canReadChannel(parent, member.guildId, roles, member)) throw new DiscordAccessError("The requester can no longer read this channel.");
    if (channel.type === 12) {
        const membership = await discordResponse(`/channels/${channel.id}/thread-members/${member.userId}`, { signal });
        if (!membership.ok) throw new DiscordAccessError("The requester cannot access this private thread.");
    }
    return channel;
}
