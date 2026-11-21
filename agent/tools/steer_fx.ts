import { defineTool } from "eve/tools";
import { fxSteering, steeringInput } from "../lib/coding/fx-steering";

export default defineTool({
    description: "Send the user's correction or changed requirement to the fx task currently working in THIS conversation. Keeps its conversation, edits and shared sandbox. Forward corrections promptly while ask_fx is running; do not cancel/restart it or edit the same files yourself. Include sufficient context and exact changed requirements. Queued means fx will receive it at its next safe boundary; do not claim it has applied the edit yet. Requires the current caller's coding access to that repository.",
    inputSchema: steeringInput,
    execute: (input, ctx) => fxSteering().enqueue(ctx.session.id, ctx.session.auth.current, input.instruction, ctx.callId),
});
