import { defineTool } from "eve/tools";
import { commentInput, comments } from "../lib/clickup/read";
export default defineTool({
    description: "Read comments on a task or list, newest first. Paginate using BOTH next.start and next.startId. Read threaded replies with commentId plus its parent taskId/listId and the page cursor where that comment appeared. Each comment's content has its own offset/maxChars window; follow nextOffset for long comments.",
    inputSchema: commentInput,
    execute: (input, ctx) => comments(input, ctx.session.auth.current, ctx.abortSignal),
});
