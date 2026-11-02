import { generateText, type ModelMessage } from "ai";

import { type Exchange, recentExchanges } from "./history";
import { SYSTEM_PROMPT } from "./prompt";

/* Through AI Gateway: OIDC on Vercel, AI_GATEWAY_API_KEY locally */
const MODEL = "openai/gpt-6.1-sol";
/* Discord's message length limit */
const MAX_LENGTH = 2000;

/**
 * Keep the bot from pinging anyone (@everyone, @here, roles) and inside Discord's length limit
 */
export function sanitize(text: string): string {
    return text.replaceAll("@", "@​").trim().slice(0, MAX_LENGTH);
}

/**
 * Have the model write the bot's next message, with its recent exchanges as earlier turns so it can call back to
 * them and not repeat itself. Resolves to null if the model fails.
 *
 * @param prompt What the bot is responding to; this is what gets remembered
 * @param context Extra facts for this message only (not remembered)
 * @param instructions Added to the system prompt
 */
export async function compose({
    prompt,
    context,
    instructions,
}: {
    prompt: string;
    context?: string;
    instructions?: string;
}): Promise<string | null> {
    let history: Exchange[] = [];
    try {
        history = await recentExchanges();
    } catch (error) {
        console.error("Discord bot: couldn't load history", error);
    }
    const messages: ModelMessage[] = [
        ...history.flatMap((past): ModelMessage[] => [
            { role: "user", content: past.prompt },
            { role: "assistant", content: past.reply },
        ]),
        { role: "user", content: context ? `${prompt}\n\n${context}` : prompt },
    ];

    try {
        const { text } = await generateText({
            model: MODEL,
            instructions: instructions ? `${SYSTEM_PROMPT}\n\n${instructions}` : SYSTEM_PROMPT,
            messages,
            maxOutputTokens: 400,
        });
        return text.trim() ? sanitize(text) : null;
    } catch (error) {
        console.error("Discord bot: model failed", error);
        return null;
    }
}
