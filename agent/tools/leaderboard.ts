import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
    description: "Read the current Big Liquid game leaderboard. Use this for questions about scores, rankings, or who's winning.",
    inputSchema: z.object({}),
    label: false,
    async execute() {
        const { topEntries } = await import("../../src/leaderboard-db");
        return { entries: await topEntries() };
    },
});
