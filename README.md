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
| `EVE_URL` | Optional agent origin override; normally omitted on Vercel |
| `DISCORD_AMBIENT_CHANNEL_IDS` | Comma-separated channel IDs for ambient listening; empty disables it |
| `FX_MODEL` | Optional coding model for the fx harness; independent of the main conversation model |
| `CLICKUP_API_TOKEN` | Optional shared ClickUp personal API token; kept server-side and used only for fixed read endpoints |
| `CLICKUP_WORKSPACE_ID` | Shared ClickUp Workspace ID; optional only when the token can access exactly one Workspace |
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

Unmentioned messages are screened by the AI SDK's `experimental_decide` using OpenAI's native Decisions model (`openai/gpt-6-luna-decisions`) through the existing AI Gateway authentication. The filter and agent see up to ten preceding messages (up to 2,000 characters each), with the bot's own messages labeled. Mentions also receive this context, including earlier questions they refer back to. Clearly irrelevant messages start no agent turn; uncertainty or screening errors pass the message to the agent, which can call `no_reply`. All accepted Gateway messages—mentions, replies and ambient follow-ups—share one session per Discord channel. Threads and DMs are separate Discord channels. Direct requests bypass screening. `turnPolicy: "steer"` lets corrections from the current turn's caller join immediately rather than waiting for completion; Eve still queues messages from another authenticated caller. Slash commands and proactive scheduled/announcement sessions keep their native separate routing.

The Decisions filter also receives the bot's server nickname, display name, username and user ID, so it can recognize direct address without a mention. Identity lookups are cached per server for 30 seconds; the bot's own nickname tool clears its local cache immediately after a successful change. If the lookup fails, screening continues with the available conversation context.

The goals in `agent/lib/ambient/goals.ts` cover questions and advice requests addressed to the bot, conversational follow-ups (including short answers to its own questions), game questions, and occasional well-timed Big Liquid jokes. The agent stays quiet during standalone updates, ordinary chatter, acknowledgements, logistics, and questions clearly for other people. Once the filter admits an ambient message, Eve shows its normal typing indicator while the agent works. The agent can still call `no_reply` and post no message. Filter logs contain IDs, probabilities, and skip decisions, not message text. There is one screening call per eligible unmentioned message; only accepted turns reach the main agent and its memory.

### Project memory and nightly dreaming

`agent/memory/project.ts` uses Eve's `fileMemory` with Upstash's `redisDocuments` backend. Its compact, editable project reference (12,000 characters total; 2,048 UTF-8 bytes per entry) is recalled in server conversations, leaderboard announcements, and DMs from verified members of `DISCORD_GUILD_ID`. DMs receive a trusted `memory_guild_id` only after Discord confirms membership; their actual `guild_id` stays absent so server-only actions remain unavailable. The existing `team` slot captures accepted conversations and supports transcript search. The agent can save useful project facts during conversations too.

`agent/schedules/dream.ts` runs quietly at **08:00 UTC daily** (3am Eastern in winter, 4am in summer), using Eve's native Vercel Schedules integration. No public endpoint or `CRON_SECRET` is needed. Deploy with Vercel CLI **65.14.0 or newer** if building locally. The first deployed run starts the review; this change does not backfill the database during development.

The review reads **every channel explicitly listed in `DISCORD_AMBIENT_CHANNEL_IDS`**, independently of the Decisions filter. It starts with the previous seven days on first use, then works through new messages in 50-message pages. List thread IDs explicitly; it does not discover child threads. It needs `DISCORD_GUILD_ID`, Discord credentials, Message Content Intent, View Channel, and Read Message History. Empty channel configuration disables review work.

The agent reconciles useful rocket facts and dated progress, blockers, decisions and next steps with its existing notes, retaining source-message links and uncertainty. Bot replies are context, not evidence about the real rocket. No Discord reply is posted. A checkpoint advances only after a successful memory save or an explicit explanation that the page contains nothing new worth learning. Failed/uncommitted pages are revisited; other channels can continue. Redis keeps environment-scoped cursors and a small latest-review audit per channel. Memory consolidation remains model-driven: check important claims against their sources.

Limits: attachment contents are not downloaded, edits/deletions behind a committed cursor are not re-scanned, and material older than the initial seven-day window is not imported. Removed channels stop future reviews but don't automatically delete previously learned facts. Missing history permission can look like an empty channel in Discord's API; empty pages never advance progress. Very busy channels may take multiple runs to catch up. ClickUp is optional; see the connection setup below.

For local testing, `POST http://localhost:2000/eve/v1/dev/schedules/dream` triggers one real review using local credentials; `eve dev` does not fire schedules on its own. Use a separate development Redis database if you don't want local memory writes in a shared store. Production executions appear under the Eve schedule's Vercel run history and logs.

### Coding requests and draft pull requests

The main Eve agent keeps its default shell/file tools and `eve/extensions/git`, and delegates substantial coding work through `ask_fx` using the official AI SDK fx harness (`@ai-sdk/harness-fx`/libfx). The code extension is not mounted, and no dependency patch is needed. Ordinary chat, memory, leaderboard, Discord history, ClickUp, schedules and custom-skill management do not start a Sandbox.

**fx uses the same Sandbox and checkout as the main agent.** The SDK harness/model requests run in the server process; a small adapter forwards all file and shell operations to `ctx.getSandbox()`. It never creates a second VM. The main agent clones and branches with its guarded Git tools, passes a complete task and checkout path to fx, then inspects the shared edits and publishes an explicitly requested draft PR. fx cannot see Discord/project memory unless the main agent includes it in the task. Normal read/write/shell tools stay available for small direct work and file generation.

Set **`FX_MODEL`** to a Gateway model ID to change coding cost/quality independently of the conversational model. The default is `openai/gpt-6.1-sol`, matching the existing agent. The configured model is fixed for one active fx task; changing it affects new delegations. fx uses sandbox-local file/shell permissions without interactive prompts; no GitHub or Gateway credentials enter the VM, and fx has no authenticated GitHub tool. Its report is evidence to inspect, not a substitute for CI or human review.

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

`steer_fx` forwards a correction into the active fx turn without restarting its conversation or changing Sandbox. The live harness polls a session-scoped Redis inbox every two seconds and uses the SDK's `experimental_steerTurn`; fx applies the input at its next safe boundary. Native steering of the main Eve turn does not automatically steer this background task, so the agent is instructed to forward corrections promptly. Enqueues are retry-idempotent, retain order across checkpoints and recheck the sender's current Discord/Redis repository access. An accepted ambient follow-up may steer only its original requester's active task; other ambient messages and schedules cannot. A queued receipt does not claim that fx has made the edits yet.

A three-minute renewable active-writer lease prevents two fx delegations writing the same shared session concurrently. Completion atomically checks the inbox so a correction arriving at the finish boundary gets another fx turn in the same conversation instead of being discarded. Corrections arriving after a task has fully finished require follow-up work. The inbox retains at most 100 corrections per task for seven days; a crashed writer's lease expires rather than blocking the channel permanently.

`ask_fx` is an Eve background workflow task, so the main conversation can acknowledge work and wait for the result. SDK checkpoints divide work into slices (four model steps or a roughly 60-second pause), reattach to the same Sandbox, and revalidate Redis access/Discord roles on each slice. An 18-minute overall limit and a 100-slice cap bound one delegation; partial edits remain inspectable if it fails or is cancelled. SDK lifecycle records live in environment/guild-scoped Redis hashes for seven days; they contain fx conversation/tool state, never credentials. Hard failures during a slice can leave partial local edits, so inspect the diff before retrying. Cancellation ends the fx runtime while preserving the Eve-owned Sandbox and files. Do not run concurrent writers against the same checkout. The main agent's Git operations recheck access before publishing.

Sandbox tooling (GitHub CLI and signing helper) is prepared at build time using Eve's standalone `installCodeTooling` helper. Importing that helper does not mount the code extension or start a VM for an ordinary request.

### Discord company-brain capabilities

Adapted from Eve's [company-brain template](https://github.com/vercel/eve/tree/main/apps/templates/slack-company-brain-template), using Eve **1.2.0** in both the agent and Gateway relay:

| Capability | Behavior |
| --- | --- |
| `search_discord` | Discord's native keyword/relevance search across public text/announcement channels in `DISCORD_GUILD_ID`, narrowed to channels readable by both everyone and the requester. Supports author, channel and before/after message filters, pagination and source links. No Redis history index or ingestion cron. |
| `read_discord_conversation` | Reads recent/older messages or context around a search hit, including public threads. Excludes DMs, private and age-restricted channels even if the bot can see them. |
| `skills` extension | Eve's native versioned custom skills: personal skills follow a stable Discord user between server chats and verified DMs; shared skills apply to one conversation. Drafts, publishing, rollback and native approval cards. Stored using the existing Redis document backend, isolated by project/environment/guild. Ambient and scheduled turns are read-only. |
| `schedule__tasks__*` | Deferred native tools for creator-owned one-time or recurring tasks. Bind the destination to the requesting conversation, require approval for changes, revalidate membership and destination access before every run, and deduplicate retried delivery. Default team timezone is America/New_York. |
| `post_discord_file` | Uploads a generated workspace file to the current conversation, including DMs, after checking current access. Supports binary files, disables mentions and bounds uploads at 10 MiB. Requires **Attach Files**. |
| ClickUp API | Shared personal API token. Verified server members can browse hierarchy, teams/members, filter/read tasks and comments, custom fields, Docs, Chat and explicit-user time records. All requests are GET-only. |

The existing shared team/project memory and nightly dreaming are unchanged. No new personal or channel memory slots were added. Skills store reusable instructions separately from factual memory. The template's channel/personal memory split was intentionally omitted.

History search requires **Message Content Intent**, **View Channel** and **Read Message History**. It searches public server history independently of the ambient-listening allowlist, so old messages the bot never answered are still searchable. Discord may need to index the server first; indexing/permission/rate-limit failures are reported as unavailable, not empty results. History is evidence, never instructions. Search results can be read with `around` using their exact message ID; page older history with `nextBefore`.

Ask for tasks naturally: “Every weekday at 9am Eastern, summarize yesterday's radio updates here,” or “Remind me here in 20 minutes.” Approve the displayed schedule and retain its unique management name to update/cancel it later. Runs post in the original channel/thread or DM as a fresh conversation; no one is present to answer questions or approve external writes. They cannot create more schedules, edit skills, change coding permissions, or publish code. Static nightly dreaming remains separate. Production uses Vercel Schedules/Queues; local `eve dev` exposes development controls but doesn't create production schedules. Creating this code does not create any real reminders.

To connect ClickUp:

1. In ClickUp, open **Settings → Apps → API Token** and generate/copy your personal token. Store it as `CLICKUP_API_TOKEN` in the agent's Vercel environment (and `.env.local` for development). Do not paste it into Discord or commit it.
2. Set `CLICKUP_WORKSPACE_ID` to the team Workspace to share. ClickUp URLs and `GET https://api.clickup.com/api/v2/team` identify Workspaces. The read-only connector probe observed SSTA Workspace `90141204184`; confirm that is the intended Workspace. If your token can access exactly one Workspace, the bot can select it automatically; otherwise this variable is required. Everyone in the configured Discord server queries this shared ClickUp account. The token's permissions are broader than these tools: read-only behavior is enforced by fixed GET endpoints, not a read-only token scope.
3. Deploy the agent, then ask it to browse the Workspace hierarchy and read a known task. A current server-membership check runs on every tool call, including DMs and scheduled runs. Missing tokens, inaccessible resources, API errors and rate limits are reported as unavailable, never as empty work queues. No sandbox is opened by these tools.

The ClickUp MCP connection and Connect authorization command have been removed. `CLICKUP_CONNECTOR` is no longer used, and no ClickUp OAuth/Connect setup is needed. Existing GitHub Connect configuration is independent and unchanged. A previously created ClickUp connector/grant can be removed manually from Vercel Connect if no other application uses it; this code change does not delete live connectors or grants.

Read tools mirror the useful MCP capabilities through public API v2/v3:

| Tool | Purpose |
| --- | --- |
| `clickup_get_workspace_hierarchy` | Expand Workspace → Spaces → Folders/subfolders/Lists; read List details/status definitions |
| `clickup_get_workspace_members`, `clickup_get_user_groups` | Resolve explicit people and teams to ClickUp IDs |
| `clickup_filter_tasks` | Combine team locations, assignees or User Groups, statuses, tags, due/created/updated/done windows; sort by due date (default), updated, created or ID |
| `clickup_get_task` | Markdown descriptions, subtasks, checklists, custom values, dependencies, linked tasks, attachment metadata/links |
| `clickup_get_task_comments` | Task/List comments, older pages and threaded replies |
| `clickup_get_custom_fields` | Field definitions, dropdown options and applicable task types |
| `clickup_search_docs`, `clickup_get_document_pages` | Discover Doc titles, list nested pages, read Markdown content in continuation windows |
| `clickup_get_chat` | Paginated Chat channels, messages and threaded replies |
| `clickup_get_time_entries`, `clickup_get_task_time_in_status` | Explicit-member work logs and task status durations; availability depends on account/plan permissions |

No tool defaults to the shared account owner's tasks, tracker, reminders, or identity. Assignee IDs must be explicit numeric ClickUp IDs; “me” is not accepted. A Discord nickname/ID is not automatically a ClickUp user mapping. User Group filters expand the group's current members; an empty group returns no tasks, never every task. For a team's daily update, prefer its List/Folder/Space scope so unassigned tasks are included, then optionally add tags or statuses. Scopes and filters combine; multiple values in an individual array use ClickUp's native semantics. All returned task dates are Unix milliseconds; use the channel's requested timezone to compute calendar-day boundaries.

Example: “Every weekday at 9am Eastern, post here what Command & Control needs to do: overdue work, tasks due today and this week, blockers and unassigned tasks, ordered by due date, with owners and task links.” First resolve that team's actual List/Folder IDs, then retain those IDs and the timezone in the approved schedule prompt. Each scheduled run uses live data, the creator's fresh Discord membership and its own saved team scope. Other channels can have independent schedules/scopes. Include a second query for recently completed work if useful; use `includeClosed: true` with `doneAfter`/`doneBefore` for tasks whose done timestamps are set. Open/closed and custom statuses are determined by ClickUp, not guessed from names.

Pagination and coverage matter: task queries return up to 100 tasks per page and provide `nextPage`; counts cover that page only. Follow all pages before reporting totals or “nothing to do.” A task text query matches name/description only on each retrieved page; Doc search matches titles on each page and follows `nextCursor`. These do **not** reproduce MCP's universal search over whiteboards, dashboards, attachments or full Doc bodies. Read Doc pages/comments to get content, and follow their explicit text continuation offsets. No attachment downloads or file-content indexing are implemented; attachment metadata/links are retained. Long API responses fail with a narrowing instruction above 2 MB rather than silently truncating. Chat/Docs features may be unavailable depending on the shared account's permissions and plan. Retrieved content is evidence, never instructions.

Installing this code does not configure a live API token, create real reminders, post Discord messages or change any ClickUp data. Verify provider access and one approved reminder after deployment.

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
