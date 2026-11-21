import { defineTool } from "eve/tools";
import { hierarchyInput, hierarchy } from "../lib/clickup/read";
export default defineTool({
    description: "Browse the shared ClickUp Workspace, then a Space's folders and folderless lists, a Folder's lists/subfolders, or a List's details/statuses. Discover team scopes by name before filtering tasks. resourceId is required below Workspace level; expand folders individually. No sandbox or individual sign-in.",
    inputSchema: hierarchyInput,
    execute: (input, ctx) => hierarchy(input, ctx.session.auth.current, ctx.abortSignal),
});
