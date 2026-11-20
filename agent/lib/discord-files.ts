import { basename, posix } from "node:path";
import { z } from "zod";
import { discordResponse } from "./discord-access";

// Stay below Discord's baseline per-file limit. Larger files must be split or compressed.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export async function readAtMost(stream: ReadableStream<Uint8Array>, limit = MAX_UPLOAD_BYTES) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return Buffer.concat(chunks, size);
            size += value.byteLength;
            if (size > limit) { await reader.cancel(); throw new Error("The file exceeds the 10 MiB upload limit. Compress or split it."); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
}
export function workspaceFile(path: string, root: string) {
    const resolved = posix.resolve(root, path);
    if (!resolved.startsWith(`${posix.resolve(root)}/`)) throw new Error("Only files in the sandbox workspace can be shared.");
    return resolved;
}
export async function postDiscordFile(channelId: string, path: string, bytes: Uint8Array, description?: string, signal?: AbortSignal, nonce?: string) {
    if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Upload requires a nonempty file at most 10 MiB.");
    const filename = basename(path);
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ allowed_mentions: { parse: [] },
        ...(nonce ? { nonce, enforce_nonce: true } : {}),
        attachments: [{ id: 0, filename, ...(description ? { description } : {}) }] }));
    form.set("files[0]", new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), filename);
    const response = await discordResponse(`/channels/${channelId}/messages`, { method: "POST", body: form, signal });
    if (!response.ok) throw new Error(`Discord file upload failed (${response.status}). Check Attach Files permission and upload size.`);
    const message = z.object({ id: z.string(), channel_id: z.string() }).parse(await response.json());
    if (message.channel_id !== channelId) throw new Error("Discord returned an unexpected upload destination.");
    return { posted: true, filename, messageId: message.id, channelId };
}
