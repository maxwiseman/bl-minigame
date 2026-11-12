import { defineChannel, POST } from "eve/channels";
import { localDev, routeAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { z } from "zod";
import { cleanName, SCORE_MAX } from "../../src/game/leaderboard";
import { describe, shouldAnnounce } from "../lib/announcements";
import discord from "./discord";

const http = eveChannel({ auth: [vercelOidc(), localDev()] });
const scoreEvent = z.object({
    id: z.uuid(),
    name: z.string().refine((name) => cleanName(name) === name),
    score: z.number().int().positive().max(SCORE_MAX),
    before: z.array(z.object({ name: z.string().max(10), score: z.number().int().positive().max(SCORE_MAX) })).max(10),
});

// Extend the Eve HTTP channel with a server-only event intake. Discord owns the
// resulting session, response delivery, follow-ups, and memory capture.
export default defineChannel({
    ...http,
    routes: [
        ...http.routes,
        POST("/eve/v1/leaderboard", async (request, ctx) => {
            const caller = await routeAuth(request, [vercelOidc(), localDev()]);
            if (caller instanceof Response) return caller;
            const parsed = scoreEvent.safeParse(await request.json().catch(() => null));
            if (!parsed.success) return Response.json({ error: "Invalid score event" }, { status: 400 });
            const event = parsed.data;
            if (!shouldAnnounce(event.before, event.score)) return Response.json({ accepted: false });
            const channelId = process.env.DISCORD_CHANNEL_ID;
            const guildId = process.env.DISCORD_GUILD_ID;
            if (!channelId || !guildId) return new Response("Announcement channel isn't configured", { status: 503 });
            const delivery = await ctx.to(discord, {
                channelId,
                conversationId: `leaderboard:${event.id}`,
            }).send(`Write a short leaderboard announcement using these facts:\n${describe(event, event.before.filter((entry) => entry.score >= event.score).length + 1)}`, {
                auth: {
                    authenticator: "leaderboard",
                    principalId: "leaderboard",
                    principalType: "service",
                    attributes: { guild_id: guildId },
                },
                idempotencyKey: `leaderboard:${event.id}`,
            });
            return Response.json({ accepted: true, sessionId: delivery.sessionId }, { status: 202 });
        }),
    ],
});
