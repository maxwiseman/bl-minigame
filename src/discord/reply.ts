import type { MentionHandler } from "chat";

import { topEntries } from "@/leaderboard-db";

import { compose } from "./compose";
import { remember } from "./history";
import { REPLY_PROMPT } from "./prompt";
import { getState } from "./state";

/* One reply per person per this long, so nobody can run up the model bill */
const COOLDOWN_MS = 10_000;

/**
 * Reply when someone @s the bot, in the same conversation as its announcements
 */
export const replyToMention: MentionHandler = async (thread, message) => {
    const { author } = message;
    // Never get into a loop with another bot
    if (author.isBot === true || author.isMe) return;
    const state = await getState();
    if (!(await state.setIfNotExists(`cooldown:${author.userId}`, true, COOLDOWN_MS))) {
        // The adapter has already opened a thread for this mention, so don't leave it empty
        await thread.post("Slow down! Try again in a few seconds 🚀");
        return;
    }

    // Drop Discord's raw <@id> mention markup; the model knows it was mentioned
    const text = message.text.replace(/<@[!&]?\d+>/g, "").trim();
    const prompt = `${author.fullName || author.userName} mentioned you: ${text}`;
    let context: string | undefined;
    try {
        const board = await topEntries();
        context = board.length
            ? `Current leaderboard:\n${board.map((e, i) => `${i + 1}. ${e.name} ${e.score.toLocaleString("en-US")}`).join("\n")}`
            : "The leaderboard is empty.";
    } catch {
        // Reply without it
    }

    const reply = await compose({ prompt, context, instructions: REPLY_PROMPT });
    if (!reply) return;
    await thread.post(reply);
    await remember({ prompt, reply });
};
