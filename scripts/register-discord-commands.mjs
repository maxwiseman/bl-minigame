/**
 * Registers the bot's slash commands with Discord, as server commands so they show up instantly.
 * Run once, and again after changing a command:
 *   npm run discord:commands
 * Needs DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID and DISCORD_GUILD_ID in .env.local (`vercel env pull` fetches them).
 */
const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID || !DISCORD_GUILD_ID) {
    console.error("Set DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID and DISCORD_GUILD_ID first");
    process.exit(1);
}

/* Handled in src/discord/reply.ts */
const commands = [
    {
        name: "ask",
        description: "Ask the Big Liquid bot something",
        options: [
            // 3 = string
            { type: 3, name: "question", description: "What do you want to ask?", required: true, max_length: 500 },
        ],
    },
];

// PUT replaces the server's whole command list with this one
const response = await fetch(
    `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
    {
        method: "PUT",
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
    },
);
if (!response.ok) {
    console.error(`Discord said ${response.status}:`, await response.text());
    process.exit(1);
}
console.log(`Registered ${commands.map((c) => `/${c.name}`).join(", ")}`);
