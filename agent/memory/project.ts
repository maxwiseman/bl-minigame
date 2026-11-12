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
        const guildId = isScheduleAuth(caller) ? process.env.DISCORD_GUILD_ID : caller?.attributes.guild_id;
        // Private conversations neither read nor contribute to the server's project knowledge.
        return typeof guildId === "string" && /^\d+$/.test(guildId) ? ["guild", guildId] : null;
    },
});
