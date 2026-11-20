import { execa } from "execa";

export interface GitResult {
  /** Process exit code; 127 when git could not be started. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  input?: string;
  env?: Record<string, string>;
  /** Network calls set this; the process is killed after it and the result has code 124. */
  timeoutMs?: number;
}

/** Exit code reported when a git call was stopped by its timeout (as in coreutils `timeout`). */
export const GIT_TIMEOUT_CODE = 124;

/** The only way core runs a process (docs/11 §2.1). Never throws for a failing command. */
export interface Git {
  run(args: string[], cwd: string, options?: GitOptions): Promise<GitResult>;
}

/**
 * Stop a timed-out git and everything it started. On Windows `git.exe` is a wrapper whose child
 * keeps the pipes open, so only a tree kill ends the call; elsewhere a remote helper may stay
 * behind, so the pipes are closed to let the caller continue.
 */
async function killTree(sub: ReturnType<typeof execa>): Promise<void> {
  // taskkill must see the wrapper alive to find its children, so it runs before any other kill.
  if (process.platform === "win32" && sub.pid !== undefined) {
    await execa("taskkill", ["/pid", String(sub.pid), "/T", "/F"], { reject: false }).catch(() => undefined);
  }
  sub.kill("SIGKILL");
  sub.stdout?.destroy();
  sub.stderr?.destroy();
}

/** Run the installed git binary, so credentials, hooks and config behave as for the user (ADR-012). */
export function execaGit(
  env: Record<string, string> = {},
  /** Replaces every network call's timeout, e.g. from AIMEM_LIVE_TIMEOUT_MS. */
  overrides: { networkTimeoutMs?: number } = {},
): Git {
  return {
    async run(args, cwd, options) {
      const timeout =
        options?.timeoutMs === undefined ? undefined : (overrides.networkTimeoutMs ?? options.timeoutMs);
      const sub = execa("git", args, {
        cwd,
        env: { ...env, ...options?.env },
        reject: false,
        ...(options?.input === undefined ? { stdin: "ignore" } : { input: options.input }),
      });
      let timedOut = false;
      let killed: Promise<void> | undefined;
      const timer = timeout
        ? setTimeout(() => {
            timedOut = true;
            killed = killTree(sub);
          }, timeout)
        : undefined;
      // Even if a killed process tree lingers, stop waiting shortly after the timeout.
      let cancelGuard = () => {};
      const deadline = timeout
        ? new Promise<undefined>((resolve) => {
            const handle = setTimeout(resolve, timeout + 3000);
            cancelGuard = () => clearTimeout(handle);
          })
        : undefined;
      const r = deadline ? await Promise.race([sub, deadline]) : await sub;
      if (timer) clearTimeout(timer);
      cancelGuard();
      // Let the tree kill finish (bounded) so callers can remove the working directory afterwards.
      if (killed) await Promise.race([killed, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (timedOut || r === undefined) return { code: GIT_TIMEOUT_CODE, stdout: "", stderr: "git timed out" };
      if (r.exitCode === undefined)
        return { code: 127, stdout: "", stderr: r.shortMessage ?? "git could not be started" };
      return { code: r.exitCode, stdout: String(r.stdout), stderr: String(r.stderr) };
    },
  };
}

export async function isGitRepo(git: Git, cwd: string): Promise<boolean> {
  const r = await git.run(["rev-parse", "--is-inside-work-tree"], cwd);
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function gitUserName(git: Git, cwd: string): Promise<string | undefined> {
  const r = await git.run(["config", "user.name"], cwd);
  const name = r.stdout.trim();
  return r.code === 0 && name ? name : undefined;
}

export interface GitDiagnostics {
  installed: boolean;
  version?: string;
  repo: boolean;
  userName?: string;
  remotes: string[];
  /** Current branch, absent when detached or not a repo. */
  branch?: string;
}

/** Read-only facts about git for `doctor` and `handoff`. Never touches the network. */
export async function gitDiagnostics(git: Git, cwd: string): Promise<GitDiagnostics> {
  const v = await git.run(["--version"], cwd);
  if (v.code !== 0) return { installed: false, repo: false, remotes: [] };
  const version = v.stdout.trim().replace(/^git version /, "");
  if (!(await isGitRepo(git, cwd))) return { installed: true, version, repo: false, remotes: [] };
  const userName = await gitUserName(git, cwd);
  const remotes = (await git.run(["remote"], cwd)).stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const b = await git.run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const branch = b.code === 0 && b.stdout.trim() !== "HEAD" ? b.stdout.trim() : undefined;
  return {
    installed: true,
    version,
    repo: true,
    ...(userName ? { userName } : {}),
    remotes,
    ...(branch ? { branch } : {}),
  };
}

/** Files changed in the working tree (tracked diffs vs HEAD plus untracked), excluding `.aimem/`. */
export async function gitChangedFiles(git: Git, cwd: string): Promise<string[]> {
  if (!(await isGitRepo(git, cwd))) return [];
  const files = new Set<string>();
  const diff = await git.run(["diff", "--name-only", "HEAD"], cwd);
  if (diff.code === 0) for (const l of diff.stdout.split("\n")) if (l.trim()) files.add(l.trim());
  const status = await git.run(["status", "--porcelain"], cwd);
  if (status.code === 0) {
    for (const l of status.stdout.split("\n")) {
      const path = l.slice(3).trim().split(" -> ").pop();
      if (path) files.add(path);
    }
  }
  return [...files].filter((f) => !f.startsWith(".aimem/")).sort();
}
