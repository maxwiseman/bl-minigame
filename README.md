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
| `DISCORD_MESSAGE_CONTENT` | Optional `true` to receive follow-ups without a mention; first enable Message Content Intent in Discord |

## Discord bot

Built with [Eve](https://eve.dev/docs/guides/frontend/nextjs), using the Next.js hosting integration (`withEve` in `next.config.ts`). The agent is authored in `agent/`; Eve runs it as a separate service alongside the game. The agent uses the same AI Gateway model and voice as before. All bot behavior lives in `agent/`; there is no Chat SDK state layer.

- **Announcements:** the leaderboard API sends a score event to `POST /eve/v1/leaderboard`. The authenticated Eve channel hands it to the Discord channel with `ctx.to(discord, target).send(...)`; Eve generates and delivers the message in a durable Discord session. The score ID deduplicates repeated events in that session.
- **Conversations:** `/ask`, bot-user @mentions, and replies to the bot. Replies stay in the channel. Eve manages durable sessions and long-term memory.
- **Memory:** `agent/memory/team.ts` uses Upstash AgentKit `redisMemory`. Server conversations and announcements share a guild-scoped slot. DMs have separate per-user memory. Both incoming messages and replies are captured, with ranked fact recall and tools to search earlier sessions. This mode does not expose AgentKit's forget tool. Use an Upstash Redis database with Redis Search support; no old history is imported.
- **Leaderboard:** the agent has one read-only tool for current rankings. General shell, file, and coding tools are disabled.
- **Speaker context:** server nicknames and role names are included, with a two-second per-user cooldown.
- **No generated pings:** Discord replies and announcements disable allowed mentions.

### Deploy on Vercel

1. Keep the project root at the repository root and use Node.js 24. The existing Next.js build command stays `npm run build`; `withEve` adds the agent service and its build automatically.
2. Set the Discord, Redis, leaderboard, and model credentials listed above in the project's production environment. The daemon needs `DISCORD_BOT_TOKEN`; Vercel injects its project OIDC token and production URL for authenticated forwarding. Normally leave `EVE_URL` unset.
3. Deploy the project to production. `vercel.json` starts **one** `discord-gateway` daemon in `iad1`, built from `daemon/Dockerfile`. Daemons run only in production during the beta; previews don't start a relay.
4. Set the Discord app's Interactions Endpoint URL to `https://blgame.maxw.app/eve/v1/discord`. The old `/api/webhooks/discord` endpoint has been removed.
5. Keep the existing `/ask` registration, or run `npm run discord:commands` when configuring a new Discord app. Invite the bot with `bot` and `applications.commands`, plus View Channel, Send Messages, Send Messages in Threads, and Read Message History.
6. Mention the **bot user**, rather than its Discord role. Check Vercel Logs for the relay connection and Agent Runs for the response.

Mentions work without the privileged Message Content intent. For thread follow-ups without another mention, enable **Message Content Intent** under **Bot** in the Discord Developer Portal, then set `DISCORD_MESSAGE_CONTENT=true` and redeploy. Requesting the intent before enabling it causes Discord to refuse the connection.

The relay is always on, but model calls run only when messages or score announcements arrive. There are no cron jobs. Vercel Daemons and Eve's Gateway support are currently beta/experimental. Messages during a relay restart can be lost; Discord doesn't replay them. Run only one relay per bot to avoid duplicate replies.

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

Verify changes with `npm run typecheck`, `npm run build`, and `npm run agent:build`. These compile the app and agent; an end-to-end Discord check additionally needs real credentials and a deployed or locally connected relay.
