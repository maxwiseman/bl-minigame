import type { WorkflowStepToolContext } from "eve/tools";
import type { FxInput } from "./fx-input";
import type { FxProgress } from "./fx";

export async function runFxSlice(input: FxInput, prior: FxProgress | null, ctx: WorkflowStepToolContext) {
    "use step";
    const { runFxSlice: run } = await import("./fx");
    return run(input, prior, ctx);
}
