import { byPrincipal, defineDynamicSchedules } from "eve/experimental/schedules";
import discord from "../channels/discord";
import { canManageTasks, prepareTask, taskAuth, taskInput } from "../lib/discord-tasks";

export default defineDynamicSchedules({
    description: "Create and manage your own one-time reminders or recurring tasks. Each run posts to the Discord channel/thread or DM where you requested it. Use America/New_York for team schedules unless the requester specifies another timezone. Write a complete task for your future self; scheduled work cannot ask follow-up questions or get approvals.",
    inputSchema: taskInput,
    tool: "deferred",
    scope: ctx => canManageTasks(ctx.session) ? byPrincipal(ctx) : null,
    preparePayload: prepareTask,
    auth: ({ principal, payload }) => taskAuth(principal, payload),
    async run({ payload, occurrence, to }) {
        await to(discord, { channelId: payload.channelId, conversationId: `task:${occurrence.executionId}` }).send([
            `Run this scheduled task for Discord user ${payload.userId} now and post the result here.`,
            `Schedule: ${occurrence.displayName ?? occurrence.name}; scheduled for ${occurrence.scheduledAt}.`,
            "No person is present to clarify or approve actions. Report missing access honestly. Use no_reply if the task explicitly asks for silence when nothing changes.",
            "Do not create other schedules, change skills or permissions, launch coding changes, or perform external writes. You may read authorized sources, update appropriate factual memory, and post the requested report or files here.",
            `Task: ${payload.task}`,
        ].join("\n"), { idempotencyKey: `${occurrence.executionId}:run` });
    },
});
