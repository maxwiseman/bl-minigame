import { defaultNamespace } from "eve/memory";
import { z } from "zod";
import { directMessageMember } from "../discord-members";
import { getRedis } from "../redis";

export const repository = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/).transform(value => value.toLowerCase());
export const discordId = z.string().regex(/^\d+$/);
export const policySchema = z.object({
    roles: z.array(discordId), repositories: z.preprocess(value => value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length ? [] : value, z.array(repository)),
    users: z.record(discordId, z.array(z.string())),
});
export type Policy = z.infer<typeof policySchema>;
export type Caller = { authenticator?: string; principalType: string; attributes: Record<string, unknown> };

export function codingPrefix() {
    return `bl:coding:${defaultNamespace({ appRoot: process.cwd(), node: "root", slot: "coding" })}:${process.env.DISCORD_GUILD_ID}`;
}

export async function codingPolicy(): Promise<Policy> {
    const redis = getRedis();
    const key = `${codingPrefix()}:policy`;
    let policy = await redis.get<Policy>(key);
    if (!policy) {
        const roles = (process.env.CODING_ADMIN_ROLE_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
        if (!roles.length) throw new Error("Coding permissions need setup: configure CODING_ADMIN_ROLE_IDS once to seed Redis.");
        const seed = policySchema.parse({ roles, repositories: (process.env.CODING_REPOSITORIES ?? "").split(",").map(value => value.trim()).filter(Boolean), users: {} });
        await redis.set(key, seed, { nx: true });
        policy = await redis.get<Policy>(key);
    }
    return policySchema.parse(policy);
}

export async function codingMember(caller: Caller | null | undefined) {
    const guildId = process.env.DISCORD_GUILD_ID;
    const userId = caller?.attributes.user_id;
    if (caller?.authenticator !== "discord-interaction" || caller.principalType !== "user"
        || typeof userId !== "string" || !/^\d+$/.test(userId)
        || (caller.attributes.guild_id ?? caller.attributes.memory_guild_id) !== guildId
        || caller.attributes.ambient === "true") {
        throw new Error("Coding actions require a direct request from a verified member of the configured Discord server.");
    }
    const member = await directMessageMember(userId);
    if (!member) throw new Error("You are no longer a member of the configured Discord server.");
    return { userId, roles: member.member.roles };
}

export function isCodingManager(policy: Policy, roles: readonly string[]) {
    return roles.some(role => policy.roles.includes(role));
}

export function canRequestChanges(policy: Policy, userId: string, roles: readonly string[], repo: string) {
    return policy.repositories.includes(repo) && (isCodingManager(policy, roles)
        || (policy.users[userId] ?? []).some(grant => grant === "*" || grant === repo));
}

export async function authorizeChanges(caller: Caller | null | undefined, repo: string) {
    const member = await codingMember(caller);
    if (!canRequestChanges(await codingPolicy(), member.userId, member.roles, repo)) throw new Error("You don't have coding access to that repository.");
    return member;
}

export const accessInput = z.discriminatedUnion("action", [
    z.object({ action: z.literal("list") }).strict(),
    z.object({ action: z.literal("grant_user"), userId: discordId, repository: repository.optional() }).strict(),
    z.object({ action: z.literal("revoke_user"), userId: discordId, repository: repository.optional() }).strict(),
    z.object({ action: z.literal("set_roles"), roleIds: z.array(discordId).min(1).max(50) }).strict(),
    z.object({ action: z.literal("set_repositories"), repositories: z.array(repository).max(100) }).strict(),
]);

// Recheck manager roles against the latest Redis policy inside the mutation, preventing
// concurrent edits from restoring revoked grants or overwriting unrelated users' access.
const MUTATE_POLICY = `
local p = cjson.decode(redis.call('GET', KEYS[1]))
local roles = cjson.decode(ARGV[1])
local manager = false
for _, role in ipairs(roles) do for _, allowed in ipairs(p.roles) do if role == allowed then manager = true end end end
if not manager then return 0 end
local input = cjson.decode(ARGV[2])
if input.action == 'set_roles' then p.roles = input.roleIds
elseif input.action == 'set_repositories' then p.repositories = input.repositories
else
  local grants = p.users[input.userId] or {}
  local grant = input.repository or '*'
  if input.action == 'grant_user' then
    if grant ~= '*' then
      local found = false
      for _, repo in ipairs(p.repositories) do if repo == grant then found = true end end
      if not found then return -1 end
    end
    local found = false
    for _, existing in ipairs(grants) do if existing == grant then found = true end end
    if not found then table.insert(grants, grant) end
    p.users[input.userId] = grants
  elseif input.repository then
    for _, existing in ipairs(grants) do if existing == '*' then return -2 end end
    local next = {}
    for _, existing in ipairs(grants) do if existing ~= grant then table.insert(next, existing) end end
    if #next == 0 then p.users[input.userId] = nil else p.users[input.userId] = next end
  else p.users[input.userId] = nil end
end
local value = cjson.encode(p)
redis.call('SET', KEYS[1], value)
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, 999)
return 1
`;

export async function manageCodingAccess(input: z.infer<typeof accessInput>, caller: Caller | null | undefined) {
    const member = await codingMember(caller);
    const policy = await codingPolicy();
    if (input.action === "list" && !isCodingManager(policy, member.roles)) return { repositories: policy.repositories.filter(repo => canRequestChanges(policy, member.userId, member.roles, repo)), manager: false };
    if (!isCodingManager(policy, member.roles)) throw new Error("Only members holding a configured coding manager role may manage access. User grants cannot be delegated.");
    if (input.action === "list") return policy;
    if (input.action === "grant_user" && !await directMessageMember(input.userId)) throw new Error("The recipient must belong to the configured Discord server.");
    if (input.action === "set_roles") {
        const api = process.env.DISCORD_API_URL ?? "https://discord.com/api/v10";
        const response = await fetch(`${api}/guilds/${process.env.DISCORD_GUILD_ID}/roles`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) throw new Error("Could not verify the new manager roles with Discord.");
        const roles = z.array(z.object({ id: discordId })).parse(await response.json());
        if (input.roleIds.some(role => !roles.some(existing => existing.id === role))) throw new Error("Every manager role must exist in the configured server.");
    }
    const result = await getRedis().eval(MUTATE_POLICY, [`${codingPrefix()}:policy`, `${codingPrefix()}:access-audit`], [
        JSON.stringify(member.roles), JSON.stringify(input),
        JSON.stringify({ actor: member.userId, at: new Date().toISOString(), ...input }),
    ]);
    if (result !== 1) throw new Error(result === -1 ? "Enable that repository before granting access to it." : result === -2 ? "This user has global access. Revoke all their grants first, then grant only the intended repositories." : "Your manager role is no longer authorized.");
    return { updated: true, ...input };
}
