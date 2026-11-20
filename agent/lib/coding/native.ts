import type { GitHubConfig } from "eve/extensions/git/sandbox";
import type { GitHubLeaseBroker } from "eve/extensions/git";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import type { VercelSandboxSession } from "eve/sandbox/vercel";
import { authorizeChanges } from "./access";

export function codingNetworkPolicy() {
    const hosts = process.env.CODING_NETWORK_HOSTS ?? "registry.npmjs.org,registry.yarnpkg.com,pypi.org,files.pythonhosted.org,crates.io,index.crates.io,static.crates.io,github.com,api.github.com,uploads.github.com,codeload.github.com,raw.githubusercontent.com,objects.githubusercontent.com,proxy.golang.org,sum.golang.org,storage.googleapis.com";
    return { allow: Object.fromEntries(hosts.split(",").map(host => host.trim()).filter(Boolean).map(host => [host, []])) };
}

export const brokerGitHubLease: GitHubLeaseBroker = async (sandbox, rules) => {
    if (!("setNetworkPolicy" in sandbox)) throw new Error("Coding requires Vercel Sandbox firewall credential delivery.");
    await (sandbox as VercelSandboxSession).setNetworkPolicy({ allow: { ...codingNetworkPolicy().allow, ...(rules ?? {}) } } as SandboxNetworkPolicy);
};

/** Permit repository inspection and draft PRs on bot branches, never merges or default-branch pushes. */
export function allowedGitCommand(argv: readonly string[], target: string | null, repo: string): boolean {
    if (target?.toLowerCase() !== repo) return false;
    const branch = (value: string | undefined) => !!value && /^big-liquid\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);
    const [executable, command, action, ...rest] = argv;
    if (executable === "git") {
        if (command === "fetch") return argv.length === 3 && action === "origin";
        if (command !== "push") return false;
        const args = argv.slice(2).filter(arg => arg !== "-u" && arg !== "--set-upstream");
        return args.length === 2 && args[0] === "origin"
            && branch(args[1]?.replace(/^HEAD:(?:refs\/heads\/)?/, ""));
    }
    if (executable === "gh-signed-commit") {
        const flags = optionValues(argv.slice(1), ["--repo", "--branch", "--base", "-m", "--message", "-b", "--body"]);
        return flags !== null && flags["--repo"]?.toLowerCase() === repo && branch(flags["--branch"]);
    }
    if (executable !== "gh") return false;
    if (command === "repo" && action === "clone") return rest.length === 2 && rest[0]?.toLowerCase() === repo && rest[1] === "repo";
    if (command === "pr" && action === "create") {
        const flags = optionValues(rest, ["--repo", "-R", "--title", "--body", "--body-file", "--base", "--head"], ["--draft"]);
        return flags !== null && flags["--draft"] === "true" && branch(flags["--head"])
            && (!flags["--repo"] && !flags["-R"] || (flags["--repo"] ?? flags["-R"])?.toLowerCase() === repo);
    }
    // Read-only GitHub inspection. Cross-repo overrides, arbitrary APIs, aliases,
    // Actions writes, merges, releases and repository administration are unavailable.
    if (!(command === "pr" && ["view", "list", "diff", "checks"].includes(action ?? "") || command === "repo" && action === "view")) return false;
    const repoFlag = argv.findIndex(value => value === "--repo" || value === "-R");
    if (repoFlag >= 0 && argv[repoFlag + 1]?.toLowerCase() !== repo) return false;
    return !argv.some(value => value.startsWith("--repo=") || value.startsWith("-R=") || value.startsWith("https://") || value === "--web");
}

function optionValues(args: readonly string[], valued: readonly string[], boolean: readonly string[] = []) {
    const flags: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const key = args[i]!;
        if (key in flags) return null;
        if (boolean.includes(key)) flags[key] = "true";
        else if (valued.includes(key) && args[i+1] !== undefined) flags[key] = args[++i]!;
        else return null;
    }
    return flags;
}

export function nativeGitConfig() {
    return {
        connector: process.env.CODING_GITHUB_CONNECTOR || "github/not-configured",
        principalType: "app", permissions: ["contents:write", "pull_requests:write"], broker: brokerGitHubLease,
        async authorize(request) {
            if (!process.env.CODING_GITHUB_CONNECTOR || !request.repository) return false;
            const repo = request.repository.toLowerCase();
            if (!allowedGitCommand(request.argv, request.repository, repo)) return false;
            await authorizeChanges(request.auth, repo);
            return true;
        },
    } satisfies GitHubConfig;
}
