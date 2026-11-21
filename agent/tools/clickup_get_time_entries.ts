import { defineTool } from "eve/tools";
import { timeInput, timeEntries } from "../lib/clickup/read";
export default defineTool({
    description: "Read time entries for an EXPLICIT ClickUp assignee ID and date range (at most 31 days), optionally scoped to task/list/folder/space. Never defaults to the token owner. No current-user tracker or account-relative tools. These are recorded work logs, not proof of task completion.",
    inputSchema: timeInput,
    execute: (input, ctx) => timeEntries(input, ctx.session.auth.current, ctx.abortSignal),
});
