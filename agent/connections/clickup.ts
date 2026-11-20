import { connect } from "@vercel/connect/eve";
import { defineDynamic, defineMcpClientConnection } from "eve/connections";
import { discordIdentity } from "../lib/discord-access";

// Configure the actual connector UID after creating and attaching it through Vercel Connect.
// Per-person OAuth avoids sharing one member's private ClickUp access with the whole server.
export default defineDynamic(({ session }) => {
    const connector = process.env.CLICKUP_CONNECTOR?.trim();
    if (!connector || !discordIdentity(session.auth.current)) return null;
    return defineMcpClientConnection({
        url: "https://mcp.clickup.com/mcp",
        description: "ClickUp: the current person's tasks, Docs, projects, owners, deadlines and status. Use live task data to ground project overviews; each person signs in with their own ClickUp account.",
        auth: connect(connector),
        approval: ({ session, toolAnnotations }) => {
            if (toolAnnotations?.readOnlyHint === true) return "not-applicable";
            if (session.schedule || session.auth.current?.attributes.ambient === "true") return "denied";
            return "user-approval";
        },
    });
});
