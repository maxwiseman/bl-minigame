import { defineTool } from "eve/tools";
import { isScheduleAuth } from "eve/schedules";
import { z } from "zod";
import { getRedis } from "../lib/redis";
import { completeProjectReview } from "../lib/project-review";

export default defineTool({
    description: "Checkpoint a reviewed page only AFTER successfully saving useful project memory. If nothing new is worth remembering (including duplicates), give a nothingToLearn explanation. Failed pages remain pending for the next run.",
    inputSchema: z.object({
        reviewId: z.string().uuid(), summary: z.string().trim().min(1).max(1000),
        nothingToLearn: z.string().trim().min(1).max(1000).optional(),
    }).strict(),
    execute(input, ctx) {
        if (!isScheduleAuth(ctx.session.auth.current)) throw new Error("Only background memory maintenance can checkpoint reviews.");
        return completeProjectReview(getRedis(), input, ctx.messages);
    },
});
