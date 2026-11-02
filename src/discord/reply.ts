import type { SlashCommandHandler } from "chat";

import { topEntries } from "@/leaderboard-db";

import { compose } from "./compose";
import { remember } from "./history";
import { REPLY_PROMPT } from "./prompt";
import { getState } from "./state";

/* One answer per person per this long, so nobody can run up the model bill */
const COOLDOWN_MS = 2_000;

/**
 * Answer /ask, in the same conversation as the bot's announcements. Discord shows "X used /ask" but not the
 * question, so the answer quotes it.
 */
export const answerAsk: SlashCommandHandler = async (event) => {
    const { user, channel } = event;
    const question = event.text.trim();
    // The adapter has already shown "thinking...", so every path has to post something
    if (!question) {
        await channel.post("Ask me something, like `/ask who's winning?`");
        return;
    }
    const state = await getState();
    if (!(await state.setIfNotExists(`cooldown:${user.userId}`, true, COOLDOWN_MS))) {
        await channel.post("Slow down! Try again in a few seconds 🚀");
        return;
    }

    // The Chat SDK only gives username and display name; the server nickname is in Discord's own payload
    const nick = (event.raw as { member?: { nick?: string | null } } | null)?.member?.nick;
    const prompt = `${nick || user.fullName || user.userName} asked you: ${question}`;
    let context: string | undefined;
    try {
        const board = await topEntries();
        context = board.length
            ? `Current leaderboard:\n${board.map((e, i) => `${i + 1}. ${e.name} ${e.score.toLocaleString("en-US")}`).join("\n")}`
            : "The leaderboard is empty.";
    } catch {
        // Answer without it
    }

    const reply = await compose({ prompt, context, instructions: REPLY_PROMPT });
    if (!reply) {
        await channel.post("My brain's offline right now, try again in a bit 🛰️");
        return;
    }
    const quoted = question.replaceAll("@", "@​").split("\n").map((line) => `> ${line}`).join("\n");
    await channel.post(`${quoted}\n${reply}`);
    await remember({ prompt, reply });
};
