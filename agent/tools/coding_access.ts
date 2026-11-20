import { defineTool } from "eve/tools";
import { accessInput, manageCodingAccess } from "../lib/coding/access";

export default defineTool({
    description: "List enabled coding repositories available to the caller. On an explicit request, current coding manager role holders can manage Redis policy, grant/revoke users, or change manager roles/repositories. A user grant permits requesting changes, never delegating access. Omit repository on grant to cover every enabled repo; omit it on revoke to remove all that user's grants. Use exact Discord IDs and owner/repo names; ask if ambiguous.",
    inputSchema: accessInput,
    execute(input, ctx) { return manageCodingAccess(input, ctx.session.auth.current); },
});
