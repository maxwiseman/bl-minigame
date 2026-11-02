import type { LeaderboardEntry } from "@/game/leaderboard";

import { announcementChannelId, getBot } from "./bot";
import { compose } from "./compose";
import { remember } from "./history";

interface HighScore {
	name: string;
	score: number;
	/* Record this one beat, if there was one */
	previous: LeaderboardEntry | null;
}

const points = (score: number) => score.toLocaleString("en-US");

function fallbackMessage({ name, score, previous }: HighScore): string {
	const beat = previous
		? `, beating ${previous.name}'s ${points(previous.score)}`
		: "";
	return `🚀 New Big Liquid high score: ${name} with ${points(score)}${beat}!`;
}

/**
 * Announce a new #1 score in Discord, written by the model; falls back to a plain message so a record is never missed
 */
export async function announceHighScore(record: HighScore): Promise<void> {
	const channelId = announcementChannelId();
	if (!channelId) return;

	const { name, score, previous } = record;
	const prompt = [
		"New high score!",
		`Player: ${name}`,
		`Score: ${points(score)}`,
		previous
			? `Previous record: ${previous.name} with ${points(previous.score)} (beaten by ${points(score - previous.score)})`
			: "Previous record: none, this is the first score on the board",
	].join("\n");

	const reply = (await compose({ prompt })) ?? fallbackMessage(record);
	try {
		const bot = await getBot();
		await bot.channel(channelId).post(reply);
		await remember({ prompt, reply });
	} catch (error) {
		console.error("High score announcement: couldn't post to Discord", error);
	}
}
