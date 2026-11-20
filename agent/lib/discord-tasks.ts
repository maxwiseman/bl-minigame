import type { SchedulePreparePayloadContext, SchedulePrincipalReference } from "eve/experimental/schedules";
import { authorizedDestination, DiscordAccessError, DiscordApiError, discordId, discordIdentity, requireDiscordMember } from "./discord-access";
import { directMessageMember } from "./discord-members";
import { z } from "zod";

export const taskInput = z.object({ task: z.string().trim().min(1).max(4000) }).strict();
export const taskPayload = taskInput.extend({ guildId: discordId, userId: discordId, channelId: discordId, dm: z.boolean() });
export type DiscordTask = z.infer<typeof taskPayload>;

export async function prepareTask(input: z.infer<typeof taskInput>, { session, abortSignal }: SchedulePreparePayloadContext): Promise<DiscordTask> {
    const caller = session.auth.current;
    if (session.schedule || caller?.attributes.ambient === "true") throw new Error("Tasks must be scheduled by a direct Discord request, not by ambient or scheduled work.");
    const member = await requireDiscordMember(caller);
    const channelId = discordId.parse(caller?.attributes.channel_id);
    const channel = await authorizedDestination(channelId, member, abortSignal);
    return { task: input.task, guildId: member.guildId, userId: member.userId, channelId, dm: channel.type === 1 };
}

export async function taskAuth(principal: SchedulePrincipalReference, raw: DiscordTask) {
    const payload = taskPayload.parse(raw);
    const principalId = payload.dm ? `discord:${payload.userId}` : `discord:${payload.guildId}:${payload.userId}`;
    const issuer = payload.dm ? "discord" : `discord:${payload.guildId}`;
    if (principal.type !== "user" || principal.authenticator !== "discord-interaction"
        || principal.principalId !== principalId || principal.issuer !== issuer || payload.guildId !== process.env.DISCORD_GUILD_ID) return null;
    const member = await directMessageMember(payload.userId);
    if (!member) return null;
    try { await authorizedDestination(payload.channelId, { ...payload, roles: member.member.roles }); }
    catch (error) {
        if (error instanceof DiscordAccessError || error instanceof DiscordApiError && [403, 404].includes(error.status)) return null;
        throw error;
    }
    return { authenticator: principal.authenticator, principalId, principalType: "user", issuer,
        ...(principal.subject ? { subject: principal.subject } : {}),
        attributes: { user_id: payload.userId, channel_id: payload.channelId,
            ...(payload.dm ? { memory_guild_id: payload.guildId } : { guild_id: payload.guildId }),
            // Scheduled work may read facts and post its result, but cannot make code changes
            // or mutate skills with the creator's interactive privileges.
            ambient: "true", scheduled_task: "true" } };
}

export function canManageTasks(session: SchedulePreparePayloadContext["session"]) {
    return !session.schedule && session.auth.current?.attributes.ambient !== "true" && !!discordIdentity(session.auth.current);
}
