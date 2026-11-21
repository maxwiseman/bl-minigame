import { z } from "zod";
import { repository } from "./repository";

export const fxInput = z.object({
    repository,
    task: z.string().trim().min(10).max(16000).describe("Complete coding request, constraints and acceptance checks. Include relevant context; fx cannot see Discord history."),
    workingDirectory: z.string().min(1).max(500).default("repo").describe("Existing checkout in the current sandbox. Clone it with git__gh first."),
}).strict();
export type FxInput = z.infer<typeof fxInput>;
