import { defineTool } from "eve/tools";
import { taskInput, getTask } from "../lib/clickup/read";
export default defineTool({
    description: "Read full task detail: Markdown description, owners/status/dates, custom fields, checklists, dependencies, linked tasks, subtasks and attachment metadata/links. customId=true supports human IDs like DEV-123. Follow description.nextOffset for long content; use clickup_get_task_comments for discussion and clickup_search_docs for Docs.",
    inputSchema: taskInput,
    execute: (input, ctx) => getTask(input, ctx.session.auth.current, ctx.abortSignal),
});
