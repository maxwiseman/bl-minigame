import customSkills from "eve/experimental/extensions/custom-skills";
import { redisDocuments } from "@upstash/agentkit-eve/memory";
import { defaultNamespace } from "eve/memory";
import { discordSkillScopes } from "../lib/discord-skills";
import { getRedis } from "../lib/redis";

export default customSkills({
    storage: redisDocuments({ redis: getRedis() }),
    namespace: `${defaultNamespace({ appRoot: process.cwd(), node: "root", slot: "custom-skills" })}:${process.env.DISCORD_GUILD_ID}`,
    scopes: discordSkillScopes,
});
