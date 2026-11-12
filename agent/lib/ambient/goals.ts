export const AMBIENT_GOAL = {
    wakeWhen:
        "Someone is asking the bot a question, asking for advice, or continuing a conversation with it, " +
        "including team or technical topics beyond the arcade game. Use the recent conversation to identify " +
        "who is being addressed. A short answer to the bot's own question is a follow-up even without a mention, " +
        "a question mark, or the bot's name. Also listen for game and leaderboard questions and well-timed Big Liquid jokes. " +
        "Ignore standalone updates, routine chatter, acknowledgements, announcements, logistics, and questions clearly for another person. " +
        "For example, 'we did a static fire today, it was sick' by itself doesn't invite a reply; " +
        "'you got any advice on securing our radio comms?' during an exchange with the bot does; " +
        "'we're using xbees' after the bot asks what radios they're using continues that exchange.",
    engagement:
        "Be willing to participate when someone is plausibly talking to you. Answer advice requests and follow-ups " +
        "even when they aren't about the game. If you asked a question, acknowledge their answer and continue from it; " +
        "don't make them mention you again. Use channel context to recover an earlier unanswered question when someone " +
        "says 'I'm talking to you'. Don't answer every standalone update or repeat earlier answers. " +
        "Use the live leaderboard for current scores. If there is nothing worth adding, call no_reply without writing any text.",
};

/** Empty or missing configuration disables ambient listening. IDs remain strings. */
export function ambientChannelIds(value = process.env.DISCORD_AMBIENT_CHANNEL_IDS): Set<string> {
    return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

export const AMBIENT_CONTEXT = [
    "This Discord message has no explicit bot mention. It may still be a question for you or a follow-up in your conversation.",
    AMBIENT_GOAL.wakeWhen,
    AMBIENT_GOAL.engagement,
].join("\n");
