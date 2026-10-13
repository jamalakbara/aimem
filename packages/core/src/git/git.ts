import { execa } from "execa";

export interface GitResult {
  /** Process exit code; 127 when git could not be started. */
  code: number;
  stdout: string;
  stderr: string;
}

/** The only way core runs a process (docs/11 §2.1). Never throws for a failing command. */
export interface Git {
  run(args: string[], cwd: string): Promise<GitResult>;
}

/** Run the installed git binary, so credentials, hooks and config behave as for the user (ADR-012). */
export function execaGit(env: Record<string, string> = {}): Git {
  return {
    async run(args, cwd) {
      const r = await execa("git", args, { cwd, env, reject: false, stdin: "ignore" });
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
