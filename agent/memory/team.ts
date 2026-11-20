import { redisMemory } from "@upstash/agentkit-eve/memory";
import { defineMemory } from "eve/memory";
import { getRedis } from "../lib/redis";

export default defineMemory({
    description: "Shared team facts, players, score announcements, and recurring jokes. Current rankings must come from the live leaderboard tool.",
    provider: redisMemory({ redis: getRedis(), topK: 5, rememberMessages: "all" }),
    scope(ctx) {
        const caller = ctx.session.auth.current;
        const guildId = caller?.attributes.guild_id ?? (caller?.authenticator === "discord-interaction" && caller.principalType === "user" ? caller.attributes.memory_guild_id : undefined);
        if (typeof guildId === "string" && guildId) return ["guild", guildId];
        // Verified member DMs use the guild above; other user contexts remain isolated.
        return caller?.principalType === "user" ? ["user", caller.principalId] : null;
    },
});
