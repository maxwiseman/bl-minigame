import { getState } from "./state";

/* State key for the bot's conversation, shared by announcements and replies to mentions */
const HISTORY_KEY = "history";
/* How many past exchanges the model sees */
const HISTORY_KEPT = 20;

/**
 * Something the bot responded to (a new record, someone's message) and what it said
 */
export interface Exchange {
    prompt: string;
    reply: string;
}

/**
 * Past exchanges, oldest first
 */
export async function recentExchanges(): Promise<Exchange[]> {
    return (await getState()).getList<Exchange>(HISTORY_KEY);
}

export async function remember(exchange: Exchange): Promise<void> {
    await (await getState()).appendToList(HISTORY_KEY, exchange, { maxLength: HISTORY_KEPT });
}
