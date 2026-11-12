export const AMBIENT_GOAL = {
    wakeWhen:
        "Someone asks about the Big Liquid arcade game, its controls, scores, leaderboard, or this bot; " +
        "or there is a specific, well-timed opportunity for a short Big Liquid joke. " +
        "Ignore routine chatter, acknowledgements, announcements, logistics, and questions directed to another person.",
    engagement:
        "Contribute only something specific and useful or a genuinely well-timed joke, in the bot's usual voice. " +
        "Don't answer every message or repeat what someone already said. Use the live leaderboard for current scores. " +
        "If there is nothing worth adding, call no_reply without writing any text.",
};

/** Empty or missing configuration disables ambient listening. IDs remain strings. */
export function ambientChannelIds(value = process.env.DISCORD_AMBIENT_CHANNEL_IDS): Set<string> {
    return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

export const AMBIENT_CONTEXT = [
    "This is an ambient Discord message, not an explicit request to the bot.",
    AMBIENT_GOAL.wakeWhen,
    AMBIENT_GOAL.engagement,
].join("\n");
