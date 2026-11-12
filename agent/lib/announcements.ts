import type { LeaderboardEntry } from "../../src/game/leaderboard";

/* Scores that make this many places get announced */
const ANNOUNCED_PLACES = 5;

export interface NewScore {
	name: string;
	score: number;
	/* The leaderboard just before this score went in */
	before: LeaderboardEntry[];
}

const points = (score: number) => score.toLocaleString("en-US");

/**
 * Place (1-based) a new score takes, given the board before it went in; ties go below the scores already there
 */
function placeOf(before: LeaderboardEntry[], score: number): number {
	return before.filter((entry) => entry.score >= score).length + 1;
}

/**
 * Whether a new score changes the top places, which is when it gets announced
 */
export function shouldAnnounce(before: LeaderboardEntry[], score: number): boolean {
	return placeOf(before, score) <= ANNOUNCED_PLACES;
}

/**
 * The facts of a top-place change, for the model
 */
export function describe({ name, score, before }: NewScore, place: number): string {
	const after = [...before.slice(0, place - 1), { name, score }, ...before.slice(place - 1)];
	const displaced = before[place - 1];
	const droppedOut = before[ANNOUNCED_PLACES - 1];
	const earlier = before.slice(0, ANNOUNCED_PLACES).findIndex((entry) => entry.name == name);

	const lines = [
		place == 1 ? "New #1 high score!" : `New top ${ANNOUNCED_PLACES} score, taking #${place}!`,
		`Player: ${name}`,
		`Score: ${points(score)}`,
	];
	if (place == 1) {
		lines.push(
			displaced
				? `Previous record: ${displaced.name} with ${points(displaced.score)} (beaten by ${points(score - displaced.score)})`
				: "Previous record: none, this is the first score on the board",
		);
	} else if (displaced) {
		lines.push(`Took #${place} from ${displaced.name} (${points(displaced.score)}), who drops to #${place + 1}`);
	}
	if (droppedOut && droppedOut != displaced) {
		lines.push(`${droppedOut.name} (${points(droppedOut.score)}) drops out of the top ${ANNOUNCED_PLACES}`);
	} else if (droppedOut) {
		lines.push(`That knocks ${droppedOut.name} out of the top ${ANNOUNCED_PLACES}`);
	}
	if (earlier >= 0) lines.push(`${name} was already in the top ${ANNOUNCED_PLACES} at #${earlier + 1}`);
	lines.push(
		`Top ${ANNOUNCED_PLACES} now:`,
		...after.slice(0, ANNOUNCED_PLACES).map((entry, i) => `${i + 1}. ${entry.name} ${points(entry.score)}`),
	);
	return lines.join("\n");
}

