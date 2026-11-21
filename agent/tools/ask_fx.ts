import { defineWorkflowTool } from "eve/tools";
import type { FxProgress } from "../lib/coding/fx";
import { runFxSlice } from "../lib/coding/fx-step";

import { fxInput } from "../lib/coding/fx-input";

export default defineWorkflowTool({
    description: "Delegate repository implementation, debugging, review or tests to the fx harness in this SAME session sandbox. First clone the authorized repository with git__gh; pass its checkout directory and a complete task. fx uses separately configured FX_MODEL and returns a local edit/check report. It cannot publish to GitHub; inspect its files and use git__gh for an explicitly requested draft PR after it finishes. Do not concurrently edit that checkout while fx is running. Requires the caller's current Redis coding access.",
    inputSchema: fxInput,
    async task(input, ctx) {
        "use workflow";
        let progress: FxProgress | null = null;
        for (let slice = 0; slice < 100; slice++) {
            const result = await runFxSlice(input, progress, ctx);
            if (result.done) return result.result;
            progress = result.progress;
        }
        throw new Error("fx reached its work limit. Its local files remain available for inspection.");
    },
});
