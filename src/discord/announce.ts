import { generateText, type ModelMessage } from "ai";

import type { LeaderboardEntry } from "@/game/leaderboard";

import { type Announcement, announcementChannelId, postAnnouncement, recentAnnouncements } from "./bot";
import { SYSTEM_PROMPT } from "./prompt";

/* Through AI Gateway: OIDC on Vercel, AI_GATEWAY_API_KEY locally */
const MODEL = "openai/gpt-6.1-sol";
/* Discord's message length limit */
const MAX_LENGTH = 2000;

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
 * Keep the bot from pinging anyone (@everyone, @here, roles) and inside Discord's length limit
 */
function sanitize(text: string): string {
	return text.replaceAll("@", "@​").trim().slice(0, MAX_LENGTH);
}

/**
 * Announce a new #1 score in Discord, written by the model; falls back to a plain message so a record is never missed
 */
export async function announceHighScore(record: HighScore): Promise<void> {
	if (!announcementChannelId()) return;

	const { name, score, previous } = record;
	const facts = [
		`Player: ${name}`,
		`Score: ${points(score)}`,
		previous
			? `Previous record: ${previous.name} with ${points(previous.score)} (beaten by ${points(score - previous.score)})`
			: "Previous record: none, this is the first score on the board",
	].join("\n");

	// Earlier announcements as past turns, so the model can call back to them and not repeat itself
	let history: Announcement[] = [];
	try {
		history = await recentAnnouncements();
	} catch (error) {
		console.error("High score announcement: couldn't load past announcements", error);
	}
	const messages: ModelMessage[] = [
		...history.flatMap((past): ModelMessage[] => [
			{ role: "user", content: past.facts },
			{ role: "assistant", content: past.text },
		]),
		{ role: "user", content: facts },
	];

	let message = fallbackMessage(record);
	try {
		const { text } = await generateText({
			model: MODEL,
			instructions: SYSTEM_PROMPT,
			messages,
			maxOutputTokens: 300,
		});
		if (text.trim()) message = text;
	} catch (error) {
		console.error(
			"High score announcement: model failed, posting the plain message",
			error,
		);
	}

	try {
		await postAnnouncement({ facts, text: sanitize(message) });
	} catch (error) {
		console.error("High score announcement: couldn't post to Discord", error);
	}
}
