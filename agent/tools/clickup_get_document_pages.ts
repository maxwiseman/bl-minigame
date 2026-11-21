import { defineTool } from "eve/tools";
import { documentInput, document } from "../lib/clickup/read";
export default defineTool({
    description: "Read a ClickUp Doc's complete page/subpage listing (docId only), or one page's Markdown content (add pageId). Page content uses offset/maxChars and content.nextOffset, so long project references can be read without silent truncation. Cite the returned source link.",
    inputSchema: documentInput,
    execute: (input, ctx) => document(input, ctx.session.auth.current, ctx.abortSignal),
});
