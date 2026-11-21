import { defineTool } from "eve/tools";
import { memberInput, members } from "../lib/clickup/read";
export default defineTool({
    description: "List or find shared ClickUp Workspace members by explicit name/email. Returns ClickUp IDs for assignee filters. Discord identities are NOT automatically mapped; never assume the token owner is the person asking. No 'me' defaults.",
    inputSchema: memberInput,
    execute: (input, ctx) => members(input, ctx.session.auth.current, ctx.abortSignal),
});
