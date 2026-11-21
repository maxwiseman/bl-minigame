import { defineTool } from "eve/tools";
import { filterInput, filterTasks } from "../lib/clickup/read";
export default defineTool({
    description: "Read tasks for project/team reports, combining explicit Space/Folder/List scopes, User Groups or assignee IDs, statuses, tags, due/updated/created/completed date windows, and sorting (due_date by default, ascending; descending optional). Includes subtasks, owners, dates and source links; no assignee filter by default, so unassigned work is included. 100 tasks per API page: follow nextPage for complete daily reports. query searches names/descriptions locally on each page; an empty page of matches is not a complete search. Dates are Unix milliseconds in the report's intended timezone.",
    inputSchema: filterInput,
    execute: (input, ctx) => filterTasks(input, ctx.session.auth.current, ctx.abortSignal),
});
