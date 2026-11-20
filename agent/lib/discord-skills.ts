import type { SkillScopeResolver, SkillScope } from "eve/experimental/extensions/custom-skills";
import { discordIdentity } from "./discord-access";

// Stable Discord IDs let personal skills follow someone between server chats and verified DMs.
// Existing channel authentication verifies DM membership before any skills can load.
export const discordSkillScopes: SkillScopeResolver = ctx => {
    const caller = ctx.session.auth.current;
    const identity = discordIdentity(caller);
    if (!identity) return [];
    const readOnly = caller?.attributes.ambient === "true" || caller?.attributes.scheduled_task === "true";
    const scopes: SkillScope[] = [{ name: "personal", key: `discord:${identity.guildId}:user:${identity.userId}`, label: "you", shared: false, readOnly }];
    const space = ctx.conversation?.space;
    if (space && space.type !== "direct" && caller?.attributes.guild_id === identity.guildId) {
        scopes.push({ name: "channel", key: `discord:${identity.guildId}:space:${space.id}`, label: "everyone in this Discord conversation", shared: true, loadPrefix: "channel", readOnly });
    }
    return scopes;
};
