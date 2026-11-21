import { defineTool } from "eve/tools";
import { statusInput, timeInStatus } from "../lib/clickup/read";
export default defineTool({
    description: "Read a task's recorded time in each status; supports explicit custom task IDs. Use as supporting evidence for blockers or aging work, not proof that a task has been completed.",
    inputSchema: statusInput,
    execute: (input, ctx) => timeInStatus(input, ctx.session.auth.current, ctx.abortSignal),
});
