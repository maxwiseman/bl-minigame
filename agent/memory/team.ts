import { redisMemory } from "@upstash/agentkit-eve/memory";
import { defineMemory } from "eve/memory";
import { getRedis } from "../lib/redis";

export default defineMemory({
    description: "Shared team facts, players, score announcements, and recurring jokes. Current rankings must come from the live leaderboard tool.",
    provider: redisMemory({ redis: getRedis(), topK: 5, rememberMessages: "all" }),
    scope(ctx) {
        const caller = ctx.session.auth.current;
        const guildId = caller?.attributes.guild_id;
        if (typeof guildId === "string" && guildId) return ["guild", guildId];
        // DMs never share the server's memory or another person's private context.
        return caller?.principalType === "user" ? ["user", caller.principalId] : null;
    },
});
