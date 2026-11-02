# Big Liquid: The Game

A pixel-art arcade game about SSTA's Big Liquid rocket: load the NOS and GOX, throttle through max Q, dodge birds, jets and space junk, and deploy the chute near apogee. Live at [blgame.maxw.app](https://blgame.maxw.app).

- Keyboard (arrows/WASD, Space, M) or Game Boy-style touch controls on phones
- Live leaderboard (Upstash Redis)
- Installable PWA that plays offline and syncs scores when back online
- Discord bot that announces top 5 changes and answers `/ask`

## Development

```bash
npm install
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
| `src/discord/` | Discord bot: announcements, `/ask`, prompts, memory |
| `src/app/api/webhooks/discord/` | Discord interactions endpoint |
| `public/sw.js` | Offline service worker |
| `scripts/register-discord-commands.mjs` | Registers `/ask` with Discord |

## Environment variables

| Variable | Used for |
| --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Leaderboard (Upstash REST) |
| `REDIS_URL` | Bot memory and cooldowns (Upstash, Chat SDK Redis state) |
| `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` | Discord app credentials |
| `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` | Server for `/ask` and channel for announcements |
| `AI_GATEWAY_API_KEY` | Local only; on Vercel, AI Gateway uses OIDC |

## Discord bot

Built with the [Chat SDK](https://chat-sdk.dev) Discord adapter, with messages written by the [AI SDK](https://ai-sdk.dev) through AI Gateway.

- **Announcements:** any score that lands in the top 5 gets posted to `DISCORD_CHANNEL_ID`.
- **`/ask`:** answered with the current leaderboard plus the asker's nickname and roles.
- **Memory:** announcements and answers share one conversation history of the last 20 exchanges, stored in Redis.
- **Prompts:** in `src/discord/prompt.ts`.

Setup:
1. Invite the bot with the `bot` and `applications.commands` scopes (View Channel, Send Messages).
2. Set the app's Interactions Endpoint URL to `https://blgame.maxw.app/api/webhooks/discord`.
3. Register `/ask`: `npm run discord:commands` (reads `.env.local`).

Everything runs as ordinary requests, so the bot works on Vercel's Hobby plan.
