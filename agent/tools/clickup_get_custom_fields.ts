import { defineTool } from "eve/tools";
import { fieldInput, fields } from "../lib/clickup/read";
export default defineTool({
    description: "Read custom-field definitions/options and task-type applied_objects for a Workspace, Space, Folder or List. Pair with task custom_fields to interpret dropdowns and relationship values. Fields defined lower in the hierarchy may require querying the List itself.",
    inputSchema: fieldInput,
    execute: (input, ctx) => fields(input, ctx.session.auth.current, ctx.abortSignal),
});
