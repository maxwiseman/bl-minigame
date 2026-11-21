import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        throw error;
    }
} });
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
const { codingPolicy, policySchema, canRequestChanges, authorizeChanges, manageCodingAccess } = await import("../agent/lib/coding/access.ts");
const { executeGitHubShell } = await import("eve/extensions/git/sandbox");
const { allowedGitCommand, nativeGitConfig, brokerGitHubLease, codingNetworkPolicy } = await import("../agent/lib/coding/native.ts");
const caller = { authenticator: "discord-interaction", principalType: "user", attributes: { user_id: "400", guild_id: "200", ambient: "false" } };
let policy, roles, membershipStatus, requests, evalResult;
beforeEach(() => {
    process.env.DISCORD_API_URL = "https://discord.invalid";
    process.env.DISCORD_BOT_TOKEN = "test-only";
    process.env.DISCORD_GUILD_ID = "200";
    process.env.CODING_GITHUB_CONNECTOR = "github/test-only";
    process.env.CODING_ADMIN_ROLE_IDS = "600";
    process.env.CODING_REPOSITORIES = "ssta/ascent";
    process.env.VERCEL_OIDC_TOKEN = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url")}.sig`;
    delete process.env.VERCEL_OIDC_TOKEN_FILE;
    policy = { roles: ["600"], repositories: ["ssta/ascent", "ssta/glass"], users: {} };
    roles = ["600"]; membershipStatus = 200; requests = []; evalResult = 1;
    const redis = command => {
        const [verb, key, ...args] = command;
        if (verb.toLowerCase() === "get") return { result: key.endsWith(":policy") ? policy : null };
        if (verb.toLowerCase() === "set") {
            if (key.endsWith(":policy") && !policy) policy = typeof args[0] === "string" ? JSON.parse(args[0]) : args[0];
            return { result: "OK" };
        }
        if (verb.toLowerCase() === "eval") return { result: String(key).includes("fx-mailbox-poll") ? [] : evalResult };
        throw new Error(`Unexpected Redis operation: ${verb}`);
    };
    globalThis.fetch = async (url, options = {}) => {
        const target = String(url), method = options.method ?? "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        requests.push({ url: target, method, body, headers: options.headers });
        if (target.startsWith("https://redis.invalid")) return Response.json(target.endsWith("/pipeline") ? body.map(redis) : redis(body));
        if (target.startsWith("https://discord.invalid")) {
            if (target.endsWith("/roles")) return Response.json([{ id: "600" }, { id: "601" }]);
            const id = target.split("/").at(-1);
            return Response.json({ user: { id }, nick: "Member", roles }, { status: membershipStatus });
        }
        throw new Error(`Unexpected request: ${method} ${target}`);
    };
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
});

test("repo-specific and global grants never enable an unconfigured repository", () => {
    policy.users["400"] = ["ssta/ascent"];
    assert(canRequestChanges(policy, "400", [], "ssta/ascent"));
    assert(!canRequestChanges(policy, "400", [], "ssta/glass"));
    policy.users["400"] = ["*"];
    assert(canRequestChanges(policy, "400", [], "ssta/glass"));
    assert(!canRequestChanges(policy, "400", ["600"], "another/private"));
});

test("fresh membership, current Redis policy, and direct caller identity gate coding", async () => {
    assert.equal((await authorizeChanges(caller, "ssta/ascent")).userId, "400");
    roles = [];
    await assert.rejects(authorizeChanges(caller, "ssta/ascent"), /don't have coding access/);
    policy.users["400"] = ["ssta/ascent"];
    assert(await authorizeChanges({ ...caller, attributes: { user_id: "400", memory_guild_id: "200" } }, "ssta/ascent"));
    delete policy.users["400"];
    await assert.rejects(authorizeChanges(caller, "ssta/ascent"));
    membershipStatus = 404;
    await assert.rejects(authorizeChanges(caller, "ssta/ascent"), /no longer a member/);
});

test("ambient messages, foreign servers and scheduled/service callers cannot code", async () => {
    for (const auth of [
        { ...caller, attributes: { ...caller.attributes, ambient: "true" } },
        { ...caller, attributes: { ...caller.attributes, guild_id: "999" } },
        { ...caller, principalType: "service" },
        { ...caller, authenticator: "app" },
    ]) await assert.rejects(authorizeChanges(auth, "ssta/ascent"), /direct request/);
    assert.equal(requests.length, 0);
});

test("user allowlist entries cannot grant access or edit manager roles", async () => {
    roles = []; policy.users["400"] = ["*"];
    await assert.rejects(manageCodingAccess({ action: "grant_user", userId: "401" }, caller), /cannot be delegated/);
    await assert.rejects(manageCodingAccess({ action: "set_roles", roleIds: ["601"] }, caller), /cannot be delegated/);
    assert(!requests.some(request => (JSON.stringify(request.body) ?? "").includes("eval")));
    assert.deepEqual(await manageCodingAccess({ action: "list" }, caller), { repositories: ["ssta/ascent", "ssta/glass"], manager: false });
});

test("role holders may grant a member a repo-specific permission with an audit record", async () => {
    const result = await manageCodingAccess({ action: "grant_user", userId: "401", repository: "ssta/ascent" }, caller);
    assert.equal(result.updated, true);
    assert(requests.some(request => request.url.endsWith("/members/401")));
    const evalRequest = requests.find(request => (JSON.stringify(request.body) ?? "").includes("eval"));
    assert(evalRequest);
    assert(JSON.stringify(evalRequest.body).includes("access-audit"));
    evalResult = 0;
    await assert.rejects(manageCodingAccess({ action: "grant_user", userId: "401" }, caller), /no longer authorized/);
});

test("role changes require real server roles and bootstrap env never overwrites Redis", async () => {
    process.env.CODING_ADMIN_ROLE_IDS = "999";
    assert.deepEqual((await codingPolicy()).roles, ["600"]);
    await assert.rejects(manageCodingAccess({ action: "set_roles", roleIds: ["999"] }, caller), /must exist/);
    assert.equal((await manageCodingAccess({ action: "set_roles", roleIds: ["601"] }, caller)).updated, true);
    assert.deepEqual(policySchema.parse({ ...policy, repositories: {} }).repositories, []);
});

test("native Git authorization rechecks grants for each command and rejects owner scopes", async () => {
    const config = nativeGitConfig();
    const request = { argv: ["git", "push", "origin", "HEAD:big-liquid/camera-status"], auth: caller, repository: "ssta/ascent", owner: "ssta", token: "test-only" };
    assert.equal(await config.authorize(request), true);
    roles = [];
    await assert.rejects(config.authorize(request), /don't have coding access/);
    policy.users["400"] = ["ssta/ascent"];
    assert.equal(await config.authorize(request), true);
    policy.repositories = [];
    await assert.rejects(config.authorize(request), /don't have coding access/);
    assert.equal(await config.authorize({ ...request, repository: null }), false);
    assert.equal(await config.authorize({ ...request, argv: ["gh", "pr", "merge", "1"] }), false);
    delete process.env.CODING_GITHUB_CONNECTOR;
    assert.equal(await config.authorize(request), false);
});

test("native command policy allows draft publication and rejects destructive or cross-repo commands", () => {
    const allowed = args => allowedGitCommand(args, "ssta/ascent", "ssta/ascent");
    for (const args of [
        ["gh", "repo", "clone", "ssta/ascent", "repo"],
        ["git", "fetch", "origin"],
        ["git", "push", "-u", "origin", "HEAD:big-liquid/camera-status"],
        ["gh-signed-commit", "--repo", "ssta/ascent", "--branch", "big-liquid/cameras", "--base", "main", "-m", "Fix cameras"],
        ["gh", "pr", "create", "--draft", "--head", "big-liquid/cameras", "--title", "Fix cameras", "--body-file", "body.md"],
        ["gh", "pr", "checks", "1", "--repo", "ssta/ascent"],
    ]) assert(allowed(args), JSON.stringify(args));
    for (const args of [
        ["git", "push", "origin", "main"],
        ["git", "push", "--force", "origin", "big-liquid/cameras"],
        ["git", "push", "origin", ":big-liquid/cameras"],
        ["gh", "pr", "create", "--head", "big-liquid/cameras"],
        ["gh", "pr", "create", "--draft", "--head", "main"],
        ["gh", "pr", "create", "--draft", "--head", "big-liquid/cameras", "--repo", "other/private"],
        ["gh", "pr", "merge", "1"],
        ["gh", "api", "repos/ssta/ascent", "--method", "DELETE"],
        ["gh-signed-commit", "--repo", "ssta/ascent", "--branch", "main", "-m", "Oops"],
    ]) assert(!allowed(args), JSON.stringify(args));
    assert(!allowedGitCommand(["git", "fetch", "origin"], "other/private", "ssta/ascent"));
});

test("credential lease teardown restores package access and removes secret transforms", async () => {
    const policies = [];
    const sandbox = { setNetworkPolicy: async policy => policies.push(policy) };
    const rules = { "api.github.com": [{ transform: [{ headers: { authorization: "Bearer secret-test-only" } }] }] };
    await brokerGitHubLease(sandbox, rules);
    assert.deepEqual(policies[0].allow["api.github.com"], rules["api.github.com"]);
    assert.deepEqual(policies[0].allow["registry.npmjs.org"], []);
    await brokerGitHubLease(sandbox, null);
    assert.deepEqual(policies[1], codingNetworkPolicy());
    assert(!JSON.stringify(policies[1]).includes("secret-test-only"));
    await assert.rejects(brokerGitHubLease({}, rules), /firewall/);
});

test("native Git tool scopes Connect tokens, denies revoked users, and removes leases after command failure", async () => {
    const policies = [], commands = [], removed = [], tokenRequests = [];
    const sandbox = {
        resolvePath: path => `/workspace/${path}`,
        setNetworkPolicy: async policy => policies.push(policy),
        removePath: async input => removed.push(input.path),
        run: async input => {
            commands.push(input);
            if (input.env) return { exitCode: 1, stdout: "", stderr: "simulated git failure" };
            return { exitCode: 0, stdout: "1 1 1", stderr: "" };
        },
    };
    const input = { command: "git push origin HEAD:big-liquid/cameras", repository: "ssta/ascent", description: "Publish camera fix branch" };
    const dependencies = {
        auth: caller, getSandbox: async () => sandbox, sessionId: "test-coding-session",
        getConnectToken: async (connector, params) => { tokenRequests.push({ connector, params }); return "secret-installation-test-only"; },
    };
    roles = [];
    await assert.rejects(executeGitHubShell(input, nativeGitConfig(), dependencies), /don't have coding access/);
    assert.equal(commands.length, 0);
    assert.equal(policies.length, 0);
    policy.users["400"] = ["ssta/ascent"];
    const result = await executeGitHubShell(input, nativeGitConfig(), dependencies);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(tokenRequests[1].params, {
        subject: { type: "app" },
        authorizationDetails: [{ type: "github_app_installation", org: "ssta", repositories: ["ascent"], permissions: ["contents:write", "pull_requests:write"] }],
    });
    assert(JSON.stringify(policies[0]).includes("secret-installation-test-only"));
    assert.deepEqual(policies.at(-1), codingNetworkPolicy());
    assert(!JSON.stringify(commands).includes("secret-installation-test-only"));
    assert(removed.length >= 2);
});

const { HarnessAgent } = await import("@ai-sdk/harness/agent");
const { runFxSlice } = await import("../agent/lib/coding/fx.ts");
const { fxSandbox } = await import("../agent/lib/coding/fx-sandbox.ts");

function sharedFxContext(origin = "https://github.com/ssta/ascent.git") {
    const files = new Map([["/workspace/repo/main.txt", "written by main"]]);
    let starts = 0, deleted = 0;
    const sandbox = {
        resolvePath: path => `/workspace/${path}`,
        run: async () => ({ exitCode: 0, stdout: `${origin}\n`, stderr: "" }),
        readTextFile: async ({ path }) => files.get(path) ?? null,
        writeTextFile: async ({ path, content }) => files.set(path, content),
        delete: async () => { deleted++; }, stop: async () => { deleted++; },
    };
    return { files, sandbox, counts: () => ({ starts, deleted }),
        session: { id: "shared-eve-session", auth: { current: caller } }, callId: "coding-call", abortSignal: new AbortController().signal,
        getSandbox: async () => { starts++; return sandbox; } };
}

const fxTask = { repository: "ssta/ascent", task: "Improve the camera status and run the relevant checks.", workingDirectory: "repo" };

test("fx delegation checks Redis/Discord access before starting a sandbox", async () => {
    roles = [];
    const ctx = sharedFxContext();
    await assert.rejects(runFxSlice(fxTask, null, ctx), /don't have coding access/);
    assert.deepEqual(ctx.counts(), { starts: 0, deleted: 0 });
});

test("fx resumes with the same shared files and separate model, leaving the VM owned by Eve", async () => {
    process.env.FX_MODEL = "test/coding-model"; process.env.AI_GATEWAY_API_KEY = "test-only";
    const original = { create: HarnessAgent.prototype.createSession, generate: HarnessAgent.prototype.generate, continue: HarnessAgent.prototype.continueGenerate };
    const ctx = sharedFxContext(); let activeSandbox, unfinished = true, destroyed = 0, prompts = 0, resumed = 0;
    const checkpoint = { type: "resume-session", harnessId: "fx", specificationVersion: "harness-v1", data: { checkpoint: "opaque" } };
    try {
        HarnessAgent.prototype.createSession = async function (options) {
            activeSandbox = options.sandboxSession; unfinished = !!(options.resumeFrom || options.continueFrom);
            if (options.resumeFrom) { assert.deepEqual(options.resumeFrom, checkpoint); resumed++; }
            return { hasUnfinishedTurn: () => unfinished, stop: async () => checkpoint, destroy: async () => { destroyed++; } };
        };
        HarnessAgent.prototype.generate = async function () {
            prompts++; unfinished = true;
            assert.equal(await activeSandbox.readTextFile({ path: "main.txt" }), "written by main");
            await activeSandbox.writeTextFile({ path: "fx.txt", content: "partial fx edit" });
            return { text: "first checks" };
        };
        HarnessAgent.prototype.continueGenerate = async function () {
            assert.equal(await activeSandbox.readTextFile({ path: "fx.txt" }), "partial fx edit");
            await activeSandbox.writeTextFile({ path: "fx.txt", content: "finished fx edit" }); unfinished = false;
            return { text: "all checks passed" };
        };
        const first = await runFxSlice(fxTask, null, ctx);
        assert.equal(first.done, false); assert.equal(first.progress.model, "test/coding-model");
        process.env.FX_MODEL = "test/new-model";
        const final = await runFxSlice(fxTask, first.progress, ctx);
        assert.equal(final.done, true); assert.equal(final.result.model, "test/coding-model");
        assert.equal(ctx.files.get("/workspace/repo/fx.txt"), "finished fx edit");
        assert.match(final.result.report, /first checks[\s\S]*all checks passed/);
        assert.equal(prompts, 1); assert.equal(resumed, 1); assert.equal(destroyed, 1);
        assert.equal(ctx.counts().deleted, 0);
        roles = [];
        const before = ctx.counts().starts;
        await assert.rejects(runFxSlice(fxTask, first.progress, ctx), /don't have coding access/);
        assert.equal(ctx.counts().starts, before);
    } finally {
        HarnessAgent.prototype.createSession = original.create;
        HarnessAgent.prototype.generate = original.generate;
        HarnessAgent.prototype.continueGenerate = original.continue;
        delete process.env.FX_MODEL;
    }
});

test("fx rejects mismatched repositories and expired work without touching GitHub", async () => {
    const ctx = sharedFxContext("https://github.com/other/private.git");
    await assert.rejects(runFxSlice(fxTask, null, ctx), /not the requested GitHub checkout/);
    const expired = { sessionId: "old", model: "test/model", startedAt: Date.now() - 19 * 60_000, summary: "" };
    const clean = sharedFxContext();
    await assert.rejects(runFxSlice(fxTask, expired, clean), /18-minute limit/);
    assert.equal(clean.counts().starts, 0);
    assert(!requests.some(request => request.url.startsWith("https://api.github.com")));
});

test("fx adapter forwards paths, bytes and cancellation into the existing sandbox", async () => {
    const ctx = sharedFxContext(); const controller = new AbortController();
    const adapter = fxSandbox(ctx.sandbox, "repo", controller.signal);
    await adapter.writeTextFile({ path: "new.txt", content: "main can inspect this" });
    assert.equal(ctx.files.get("/workspace/repo/new.txt"), "main can inspect this");
    let observed;
    ctx.sandbox.run = async options => { observed = options; return { exitCode: 0, stdout: "done", stderr: "" }; };
    await adapter.run({ command: "npm test", env: { CHECK: "1" } });
    assert.equal(observed.workingDirectory, "/workspace/repo"); assert.equal(observed.command, "npm test");
    assert.deepEqual(observed.env, { CHECK: "1" });
    controller.abort(); assert(observed.signal.aborted);
    assert.throws(() => fxSandbox(ctx.sandbox, "../../outside"), /shared sandbox/);
    assert.equal(ctx.counts().deleted, 0);
});

test("timed fx slices preserve continuation state without destroying the shared VM", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    process.env.AI_GATEWAY_API_KEY = "test-only";
    const original = { create: HarnessAgent.prototype.createSession, generate: HarnessAgent.prototype.generate };
    const ctx = sharedFxContext(); let resolveResult, markStarted, destroyed = 0, unfinished = false;
    const started = new Promise(resolve => { markStarted = resolve; });
    const continuation = { type: "continue-turn", harnessId: "fx", specificationVersion: "harness-v1", data: { paused: true } };
    try {
        HarnessAgent.prototype.createSession = async () => ({
            hasUnfinishedTurn: () => unfinished,
            suspendTurn: async () => { resolveResult({ text: "paused safely" }); return continuation; },
            destroy: async () => { destroyed++; },
        });
        HarnessAgent.prototype.generate = async () => {
            unfinished = true; markStarted(); return new Promise(resolve => { resolveResult = resolve; });
        };
        const pending = runFxSlice(fxTask, null, ctx);
        await started;
        t.mock.timers.tick(60_000);
        const result = await pending;
        assert.equal(result.done, false);
        assert.deepEqual(result.progress.continuation, continuation);
        assert.equal(result.progress.resume, undefined);
        assert.equal(destroyed, 0); assert.equal(ctx.counts().deleted, 0);
    } finally { HarnessAgent.prototype.createSession = original.create; HarnessAgent.prototype.generate = original.generate; }
});
