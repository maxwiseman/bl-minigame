import type { Experimental_SandboxSession } from "ai";
type Experimental_SandboxSpawnOptions = Parameters<Experimental_SandboxSession["spawn"]>[0];
type Experimental_SandboxProcess = Awaited<ReturnType<Experimental_SandboxSession["spawn"]>>;
type Experimental_WritableSandboxProcess = Experimental_SandboxProcess & { readonly stdin: WritableStream<Uint8Array> };
type Experimental_SandboxSpawnOptionsWithStdin = Experimental_SandboxSpawnOptions & { stdin: true };
type Experimental_SandboxSpawnOptionsWithoutStdin = Experimental_SandboxSpawnOptions & { stdin?: false };
import type { SandboxSession } from "eve/sandbox";
import { posix } from "node:path";

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Adapt the existing Eve sandbox. No VM is created, stopped or destroyed here. */
export function fxSandbox(sandbox: SandboxSession, workDir: string, signal?: AbortSignal): Experimental_SandboxSession {
    const root = posix.resolve(sandbox.resolvePath(""));
    const cwd = posix.resolve(root, workDir);
    if (cwd !== root && !cwd.startsWith(`${root}/`)) throw new Error("fx working directory must stay in the shared sandbox workspace.");
    const path = (value: string) => posix.resolve(cwd, value);
    const signals = (extra?: AbortSignal) => {
        const all = [signal, extra].filter((s): s is AbortSignal => !!s);
        return all.length ? AbortSignal.any(all) : undefined;
    };
    async function metadata(file: string, operation: "stat" | "list" | "delete", extra?: AbortSignal) {
        const script = `import os,sys,json,stat
p=sys.argv[1]; op=sys.argv[2]
try:
 if op=='stat':
  s=os.stat(p); r={'type':'file' if stat.S_ISREG(s.st_mode) else 'directory' if stat.S_ISDIR(s.st_mode) else 'other','size':s.st_size}
 elif op=='list':
  r=[{'name':e.name,'type':'symlink' if e.is_symlink() else 'directory' if e.is_dir() else 'file' if e.is_file() else 'other'} for e in os.scandir(p)]
 else:
  os.unlink(p); r=True
except FileNotFoundError: r=False if op=='delete' else None
print(json.dumps(r))`;
        const result = await sandbox.run({ command: `python3 -c ${shellQuote(script)} ${shellQuote(path(file))} ${operation}`, workingDirectory: cwd, signal: signals(extra) });
        if (result.exitCode !== 0) throw new Error(`Sandbox ${operation} failed: ${result.stderr.slice(0, 2000)}`);
        return JSON.parse(result.stdout);
    }
    function spawn(options: Experimental_SandboxSpawnOptionsWithStdin): Promise<Experimental_WritableSandboxProcess>;
    function spawn(options: Experimental_SandboxSpawnOptionsWithoutStdin): Promise<Experimental_SandboxProcess>;
    function spawn(options: Experimental_SandboxSpawnOptions): Promise<Experimental_SandboxProcess>;
    async function spawn({ abortSignal, workingDirectory, ...options }: Experimental_SandboxSpawnOptions): Promise<Experimental_SandboxProcess> {
        const child = await sandbox.spawn({ ...options, workingDirectory: workingDirectory ? path(workingDirectory) : cwd, signal: signals(abortSignal) });
        if (options.stdin && !child.stdin) { await child.kill(); throw new Error("Sandbox did not provide requested stdin."); }
        return { stdout: child.stdout, stderr: child.stderr, ...(child.stdin ? { stdin: child.stdin } : {}),
            wait: async () => await child.wait(), kill: async () => { await child.kill(); } };
    }
    return {
        description: `The main Eve agent's existing sandbox. Working directory: ${cwd}. Files are shared with the main agent.`,
        run: ({ abortSignal, workingDirectory, ...options }) => sandbox.run({ ...options, workingDirectory: workingDirectory ? path(workingDirectory) : cwd, signal: signals(abortSignal) }),
        spawn,
        readFile: ({ path: file, abortSignal }) => sandbox.readFile({ path: path(file), signal: signals(abortSignal) }),
        readBinaryFile: ({ path: file, abortSignal }) => sandbox.readBinaryFile({ path: path(file), signal: signals(abortSignal) }),
        readTextFile: ({ path: file, abortSignal, ...options }) => sandbox.readTextFile({ ...options, path: path(file), signal: signals(abortSignal) }),
        writeFile: ({ path: file, abortSignal, ...options }) => sandbox.writeFile({ ...options, path: path(file), signal: signals(abortSignal) }),
        writeBinaryFile: ({ path: file, abortSignal, ...options }) => sandbox.writeBinaryFile({ ...options, path: path(file), signal: signals(abortSignal) }),
        writeTextFile: ({ path: file, abortSignal, ...options }) => sandbox.writeTextFile({ ...options, path: path(file), signal: signals(abortSignal) }),
        stat: ({ path, abortSignal }) => metadata(path, "stat", abortSignal),
        listDirectory: ({ path, abortSignal }) => metadata(path, "list", abortSignal),
        deleteFile: ({ path, abortSignal }) => metadata(path, "delete", abortSignal),
    };
}
