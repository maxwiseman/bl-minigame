import { createHash } from "node:crypto";
import { isChannel } from "eve/channels";
import { defineTool } from "eve/tools";
import { z } from "zod";
import discord from "../channels/discord";
import { authorizedDestination, requireDiscordMember } from "../lib/discord-access";
import { postDiscordFile, readAtMost, workspaceFile } from "../lib/discord-files";

export default defineTool({
    description: "Upload a file you created in the sandbox workspace (chart, CSV, report, image) to the current Discord conversation. Files are not shared automatically. One nonempty file per call, at most 10 MiB. The destination comes from this conversation, never from model input. Only post files requested by the user or needed for their task; avoid secrets and internal files.",
    inputSchema: z.object({ path: z.string().min(1), description: z.string().max(1000).optional() }).strict(),
    async execute({ path, description }, ctx) {
        if (!isChannel(ctx.channel, discord)) throw new Error("Files can only be posted in Discord conversations.");
        const channelId = ctx.channel.metadata.channelId;
        if (!channelId || ctx.session.auth.current?.attributes.channel_id !== channelId) throw new Error("This session has no matching Discord destination.");
        const member = await requireDiscordMember(ctx.session.auth.current);
        await authorizedDestination(channelId, member, ctx.abortSignal);
        const sandbox = await ctx.getSandbox();
        let file = workspaceFile(path, sandbox.resolvePath(""));
        const real = await sandbox.run({ command: `realpath -e -- '${file.replaceAll("'", "'\\''")}'` });
        if (real.exitCode !== 0) throw new Error(`File does not exist: ${file}`);
        file = workspaceFile(real.stdout.trim(), sandbox.resolvePath(""));
        const stream = await sandbox.readFile({ path: file });
        if (!stream) throw new Error(`File does not exist: ${file}`);
        const bytes = await readAtMost(stream);
        const nonce = BigInt(`0x${createHash("sha256").update(`${ctx.session.id}:${ctx.callId}`).digest("hex").slice(0, 16)}`).toString();
        return postDiscordFile(channelId, file, bytes, description, ctx.abortSignal, nonce);
    },
});
