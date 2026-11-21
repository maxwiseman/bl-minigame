import { defineTool } from "eve/tools";
import { memberInput, groups } from "../lib/clickup/read";
export default defineTool({
    description: "Read ClickUp User Groups (teams) and their current members, optionally matching a name. Use group IDs with clickup_filter_tasks for explicit assignee-based team filtering. For daily updates about unassigned work, prefer team List/Folder scopes instead.",
    inputSchema: memberInput,
    execute: (input, ctx) => groups(input, ctx.session.auth.current, ctx.abortSignal),
});
