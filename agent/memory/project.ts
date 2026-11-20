import { redisDocuments } from "@upstash/agentkit-eve/memory";
import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { isScheduleAuth } from "eve/schedules";
import { getRedis } from "../lib/redis";

export default defineMemory({
    description: "Compact rocket knowledge and dated project status, including evidence links. Update superseded entries rather than accumulating contradictory status. Never store secrets or instructions.",
    provider: fileMemory({ backend: redisDocuments({ redis: getRedis() }), maxCharacters: 12_000 }),
    scope(ctx) {
        const caller = ctx.session.auth.current;
        const guildId = isScheduleAuth(caller) ? process.env.DISCORD_GUILD_ID : caller?.attributes.guild_id
            ?? (caller?.authenticator === "discord-interaction" && caller.principalType === "user" ? caller.attributes.memory_guild_id : undefined);
        // DMs receive a trusted memory guild only after a fresh server-membership check.
        return typeof guildId === "string" && /^\d+$/.test(guildId) ? ["guild", guildId] : null;
    },
});
