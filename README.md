# Big Liquid: The Game

A pixel-art arcade game about SSTA's Big Liquid rocket: load the NOS and GOX, throttle through max Q, dodge birds, jets and space junk, and deploy the chute near apogee. Live at [blgame.maxw.app](https://blgame.maxw.app).

- Keyboard (arrows/WASD, Space, M) or Game Boy-style touch controls on phones
- Live leaderboard (Upstash Redis)
- Installable PWA that plays offline and syncs scores when back online
- Eve Discord agent that announces top 5 changes and answers `/ask` and @mentions

## Development

```bash
npm install  # Node.js 24
vercel env pull .env.local   # optional: leaderboard and bot credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without credentials the game still runs; the leaderboard shows as offline and the bot does nothing. The service worker only registers in production builds (`npm run build && npm start`).

## Layout

| Path | What's there |
| --- | --- |
| `src/game/` | Engine (pure game state and `update`), renderer, sprites, sound, shared leaderboard rules |
| `src/components/` | The game component, touch controls, service worker registration |
| `src/app/api/leaderboard/` | Leaderboard API (GET top 10, POST a score) |
| `src/leaderboard-db.ts` | Upstash client and leaderboard queries |
| `agent/` | Eve agent: instructions, channels, leaderboard tool, Upstash memory, and Discord helpers |
| `daemon/` | Discord Gateway relay and container image for Vercel Daemons |
| `src/agent.ts` | Sends score events to Eve's authenticated announcement endpoint |
| `public/sw.js` | Offline service worker |
| `scripts/register-discord-commands.mjs` | Registers `/ask` with Discord |

## Environment variables

| Variable | Used for |
| --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Leaderboard (Upstash REST) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Eve memory and cooldowns; falls back to the leaderboard's `KV_REST_API_*` credentials |
| `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` | Discord app credentials |
| `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` | Server for `/ask` and channel for announcements |
| `AI_GATEWAY_API_KEY` | Local only; on Vercel, AI Gateway uses OIDC |
| `CLICKUP_CONNECTOR` | Optional Vercel Connect ClickUp connector UID, e.g. `clickup/big-liquid` |
| `CLICKUP_LIST_IDS` | Comma-separated approved ClickUp home List IDs (1–20); shared read access for verified server members |
| `EVE_URL` | Optional agent origin override; normally omitted on Vercel |
| `DISCORD_AMBIENT_CHANNEL_IDS` | Comma-separated channel IDs for ambient listening; empty disables it |
| `DISCORD_MESSAGE_CONTENT` | Optional `true` to receive follow-ups without a mention; first enable Message Content Intent in Discord |

## Discord bot

Built with [Eve](https://eve.dev/docs/guides/frontend/nextjs), using the Next.js hosting integration (`withEve` in `next.config.ts`). The agent is authored in `agent/`; Eve runs it as a separate service alongside the game. The agent uses the same AI Gateway model and voice as before. All bot behavior lives in `agent/`; there is no Chat SDK state layer.

- **Announcements:** the leaderboard API sends a score event to `POST /eve/v1/leaderboard`. The authenticated Eve channel hands it to the Discord channel with `ctx.to(discord, target).send(...)`; Eve generates and delivers the message in a durable Discord session. The score ID deduplicates repeated events in that session.
- **Conversations:** `/ask`, bot-user @mentions, and replies to the bot. Replies stay in the channel. Eve manages durable sessions and long-term memory.
- **Memory:** `agent/memory/team.ts` uses Upstash AgentKit `redisMemory`. Server conversations, announcements, and verified member DMs share the server's memory. Both incoming messages and replies are captured, with ranked fact recall and tools to search earlier sessions. This includes accepted DMs: they contribute to the shared team memory rather than a separate private store. This mode does not expose AgentKit's forget tool. Use an Upstash Redis database with Redis Search support; no old history is imported.
- **Leaderboard:** the agent has one read-only tool for current rankings. General shell, file, and coding tools are disabled.
- **Nickname:** the `change_nickname` tool can change or clear only the bot's own nickname in the current server, using Discord's `/members/@me` endpoint. Grant **Change Nickname** to the bot role; **Manage Nicknames** is unnecessary. The tool accepts no user or server ID and is unavailable from DMs or automated announcements.
- **Speaker context:** server nicknames, role names, and stable Discord user IDs are included, with a two-second per-user cooldown. In DMs, the bot fetches the sender's membership in `DISCORD_GUILD_ID` on every message and resolves their nickname/roles from that server. Nonmembers and unverifiable requests do not start an agent turn. No privileged Guild Members intent is needed for this individual lookup.
- **No generated pings:** Discord replies and announcements disable allowed mentions.

### Deploy on Vercel

1. Keep the project root at the repository root and use Node.js 24. The existing Next.js build command stays `npm run build`; `withEve` adds the agent service and its build automatically.
2. Set the Discord, Redis, leaderboard, and model credentials listed above in the project's production environment. The daemon needs `DISCORD_BOT_TOKEN`; Vercel injects its project OIDC token and production URL for authenticated forwarding. Normally leave `EVE_URL` unset.
3. Deploy the project to production. `vercel.json` starts **one** `discord-gateway` daemon in `iad1`, built from `daemon/Dockerfile`. Daemons run only in production during the beta; previews don't start a relay.
4. Set the Discord app's Interactions Endpoint URL to `https://blgame.maxw.app/eve/v1/discord`. The old `/api/webhooks/discord` endpoint has been removed.
5. Keep the existing `/ask` registration, or run `npm run discord:commands` when configuring a new Discord app. Invite the bot with `bot` and `applications.commands`, plus View Channel, Send Messages, Send Messages in Threads, and Read Message History.
6. Mention the **bot user**, rather than its Discord role. Check Vercel Logs for the relay connection and Agent Runs for the response.

Mentions work without the privileged Message Content intent. For thread follow-ups without another mention, enable **Message Content Intent** under **Bot** in the Discord Developer Portal, then set `DISCORD_MESSAGE_CONTENT=true` and redeploy. Requesting the intent before enabling it causes Discord to refuse the connection.

The relay is always on; model calls run for messages, score announcements, and the nightly memory review below. Vercel Daemons and Eve's Gateway support are currently beta/experimental. Messages during a relay restart can be lost; Discord doesn't replay them. Run only one relay per bot to avoid duplicate replies.

The daemon uses `@vercel/oidc` 4.x directly for outbound authentication, reading Vercel's rotating `VERCEL_OIDC_TOKEN_FILE` on every dispatch. Eve rc.10's bundled OIDC helper predates token-file support; using it leaves the bot online but causes forwarded messages to fail with 401. Never copy the rotating token into a cached value or long-lived environment variable.

### Ambient listening

Enable **Message Content Intent** under **Bot** in the Discord Developer Portal. Then set this in the Vercel project's production environment (shared by the agent and daemon), and redeploy:

```text
DISCORD_AMBIENT_CHANNEL_IDS=123456789012345678,234567890123456789
```

Only those exact channels are watched; list thread IDs separately if needed. Empty or missing configuration disables ambient listening. Configuring any channel automatically requests Message Content Intent in the daemon, so enable it in Discord first. If Discord rejects that intent with code 4014, the relay falls back to mentions and DMs; after enabling the intent, restart the daemon to restore ambient listening. The bot also needs View Channel and Read Message History in each watched channel.

Unmentioned messages are screened by the AI SDK's `experimental_decide` using OpenAI's native Decisions model (`openai/gpt-6-luna-decisions`) through the existing AI Gateway authentication. The filter and agent see up to ten preceding messages (up to 2,000 characters each), with the bot's own messages labeled. Mentions also receive this context, including earlier questions they refer back to. Clearly irrelevant messages start no agent turn; uncertainty or screening errors pass the message to the agent, which can call `no_reply`. Accepted ambient messages share one session per channel. Direct requests keep the existing behavior and bypass screening.

The Decisions filter also receives the bot's server nickname, display name, username and user ID, so it can recognize direct address without a mention. Identity lookups are cached per server for 30 seconds; the bot's own nickname tool clears its local cache immediately after a successful change. If the lookup fails, screening continues with the available conversation context.

The goals in `agent/lib/ambient/goals.ts` cover questions and advice requests addressed to the bot, conversational follow-ups (including short answers to its own questions), game questions, and occasional well-timed Big Liquid jokes. The agent stays quiet during standalone updates, ordinary chatter, acknowledgements, logistics, and questions clearly for other people. Once the filter admits an ambient message, Eve shows its normal typing indicator while the agent works. The agent can still call `no_reply` and post no message. Filter logs contain IDs, probabilities, and skip decisions, not message text. There is one screening call per eligible unmentioned message; only accepted turns reach the main agent and its memory.

### Project memory and nightly dreaming

`agent/memory/project.ts` uses Eve's `fileMemory` with Upstash's `redisDocuments` backend. Its compact, editable project reference (12,000 characters total; 2,048 UTF-8 bytes per entry) is recalled in server conversations, leaderboard announcements, and DMs from verified members of `DISCORD_GUILD_ID`. DMs receive a trusted `memory_guild_id` only after Discord confirms membership; their actual `guild_id` stays absent so server-only actions remain unavailable. The existing `team` slot captures accepted conversations and supports transcript search. The agent can save useful project facts during conversations too.

`agent/schedules/dream.ts` runs quietly at **08:00 UTC daily** (3am Eastern in winter, 4am in summer), using Eve's native Vercel Schedules integration. No public endpoint or `CRON_SECRET` is needed. Deploy with Vercel CLI **65.14.0 or newer** if building locally. The first deployed run starts the review; this change does not backfill the database during development.

The review reads **every channel explicitly listed in `DISCORD_AMBIENT_CHANNEL_IDS`**, independently of the Decisions filter. It starts with the previous seven days on first use, then works through new messages in 50-message pages. List thread IDs explicitly; it does not discover child threads. It needs `DISCORD_GUILD_ID`, Discord credentials, Message Content Intent, View Channel, and Read Message History. Empty channel configuration disables review work.

The agent reconciles useful rocket facts and dated progress, blockers, decisions and next steps with its existing notes, retaining source-message links and uncertainty. Bot replies are context, not evidence about the real rocket. No Discord reply is posted. A checkpoint advances only after a successful memory save or an explicit explanation that the page contains nothing new worth learning. Failed/uncommitted pages are revisited; other channels can continue. Redis keeps environment-scoped cursors and a small latest-review audit per channel. Memory consolidation remains model-driven: check important claims against their sources.

Limits: attachment contents are not downloaded, edits/deletions behind a committed cursor are not re-scanned, and material older than the initial seven-day window is not imported. Removed channels stop future reviews but don't automatically delete previously learned facts. Missing history permission can look like an empty channel in Discord's API; empty pages never advance progress. Very busy channels may take multiple runs to catch up. ClickUp is not part of the nightly review; the optional connector below is for direct requests only.

For local testing, `POST http://localhost:2000/eve/v1/dev/schedules/dream` triggers one real review using local credentials; `eve dev` does not fire schedules on its own. Use a separate development Redis database if you don't want local memory writes in a shared store. Production executions appear under the Eve schedule's Vercel run history and logs.

### Coding requests and draft pull requests

The main Eve agent mounts `eve/extensions/code` and `eve/extensions/git` directly, like the company-brain template. It reads and edits files, runs checks in a session Vercel Sandbox, and uses the Git extension to open draft PRs. Eve provides the coding loop and Sandbox lifecycle. There is no separate coding agent or fx job runner. Code tooling is installed into a prepared Sandbox snapshot at agent build time; the code extension opens the session Sandbox on the first turn to read workspace instructions.

GitHub access uses a **GitHub App through Vercel Connect**. Each authenticated command declares a full `owner/repo`; the extension obtains a scoped installation token and delivers it at the Sandbox firewall. Processes receive a placeholder rather than the credential. The authorization callback checks current Discord membership/roles and the current Redis policy on each command. It allows repository inspection, bot branch publication under `big-liquid/`, and draft PR creation; merges, force pushes, arbitrary API writes and repository administration are blocked.

To enable this later:

1. Create and attach a Vercel Connect GitHub App connector with **only selected repositories**, granting **Contents: read/write** and **Pull requests: read/write**.
2. Set `CODING_GITHUB_CONNECTOR` to its actual connector UID (for example `github/big-liquid`). Use an installation for the intended GitHub organization.
3. Set `CODING_ADMIN_ROLE_IDS` to comma-separated Discord role IDs and `CODING_REPOSITORIES` to comma-separated `owner/repo` names. Together with `DISCORD_GUILD_ID` and Redis credentials, these seed the policy **only if it does not already exist**. Later env changes do not overwrite dynamic permissions.
4. Deploy and explicitly ask for a small change in an enabled repository. No connector, production grants or real PRs are created by installing this code.

The `coding_access` tool manages the Redis policy:

- Configured manager role holders may request changes in enabled repos, grant/revoke other server members, and update manager roles or enabled repositories.
- User grants cover one repo or all enabled repos. They permit requesting changes, never granting access to others.
- Membership/roles are verified with Discord on every action, including verified DMs. Ambient messages and scheduled/service callers cannot authorize GitHub commands or access changes.
- Non-managers can list only their accessible repos. Policy mutations recheck manager roles against the latest Redis policy atomically and append an audit entry.

Redis stores the policy at an environment/project/guild-scoped `bl:coding:…:policy` key and a capped 1,000-entry access audit. Eve manages session state and Sandbox files separately. The Sandbox uses 2 vCPUs and a 20-minute runtime timeout; this is not an overall coding-task deadline. `CODING_NETWORK_HOSTS` optionally replaces the package-registry/GitHub host allowlist for repositories needing other dependencies. Sandbox preparation and runtime need Vercel credentials; deployments supply these automatically, while local builds use the linked project's OIDC credentials. CI and human review determine whether a draft is ready to merge.

### Read-only ClickUp connector

The `clickup` tool uses the Vercel Connect TypeScript SDK and ClickUp REST API v2, not MCP. It is disabled until configured; this code does not create an installation or deploy credentials.

1. Create a ClickUp connector in Vercel Connect (for example `vercel connect create clickup --name big-liquid`), authorize an **app-scoped** installation for the intended workspace, and link it to this project and the intended environments. Use a ClickUp account with the minimum required access.
2. Set `CLICKUP_CONNECTOR` to its actual UID and `CLICKUP_LIST_IDS` to the numeric home List IDs approved for sharing with **every verified member of `DISCORD_GUILD_ID`**. This is shared app access, not each member's personal ClickUp permissions. Do not enable private/restricted lists. Existing Discord bot credentials are required for a fresh membership check on every read.
3. Redeploy after review. For local development, use `vercel env pull .env.local` for the linked project's OIDC environment. No ClickUp API token belongs in Discord, source files, or a client bundle.
4. Ask via `/ask`, a direct bot mention, or a verified member DM: “Which ClickUp lists can you read?” then “Show open tasks in list …”. The tool can identify configured lists, fetch one page of tasks, or retrieve a task by its native ID. Follow `nextPage` for complete coverage; closed tasks require `includeClosed: true`.

Only GET requests to `api.clickup.com` are implemented. Task details must have a configured **home** list; tasks present only through a secondary list are excluded. Responses include task links, status, assignees, due dates and retrieval timestamps; descriptions are limited to 8,000 characters and explicitly marked when truncated. Emails, custom fields, sharing tokens, attachments and comments are not returned. Task status is a planning record, not proof of a successful test. Ambient turns, schedules, announcements, other servers and departed members cannot use the connector. Nothing is automatically imported into memory.

A missing configuration, failed Connect authorization, inaccessible item, rate limit or API failure is reported rather than treated as an empty task list. Automated tests mock both Connect token exchange and ClickUp; a real app installation and deployed Discord smoke test are still needed to verify live access.

### Local agent development

`npm run dev` starts Next.js and the Eve agent. `npm run agent:dev` runs the agent alone (normally on port 2000). To test Gateway messages locally, stop the production relay first, then in a second terminal:

```bash
EVE_URL=http://localhost:2000 npm run discord:relay
```

The relay script reads `.env.local`. If that file was pulled from Vercel and includes `VERCEL=1`, clear it when running locally (`VERCEL= npm run dev`) so Eve uses local hosting. Keep production stopped while the local relay is connected, and restore it afterwards.

For a local production build, build both services before starting Next.js:

```bash
VERCEL= NITRO_PRESET=node-server npm run agent:build
VERCEL= npm run build
VERCEL= npm start
```

Verify changes with `npm run test:agent`, `npm run typecheck`, `npm run build`, and `npm run agent:build`. These compile the app and agent; an end-to-end Discord check additionally needs real credentials and a deployed or locally connected relay.
