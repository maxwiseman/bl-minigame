import { defineTool } from "eve/tools";
import { docsInput, docs } from "../lib/clickup/read";
export default defineTool({
    description: "Discover shared Workspace Docs, optionally narrowing to a parent and filtering Doc TITLES by query on each page. Follow nextCursor even with zero matches. This is not full-text search or MCP's universal search. Use clickup_get_document_pages to discover and read Markdown page content.",
    inputSchema: docsInput,
    execute: (input, ctx) => docs(input, ctx.session.auth.current, ctx.abortSignal),
});
