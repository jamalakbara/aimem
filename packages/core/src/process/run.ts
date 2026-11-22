import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { setPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

export interface ProcessResult {
  /** Exit code; 127 when the program could not be started. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  /** Written to stdin, then stdin is closed. */
  input?: string;
  /**
   * Files written into a fresh, empty temp directory that becomes the working directory and is
   * removed afterwards. Keeps the child away from the project (no CLAUDE.md discovery etc.).
   */
  files?: Record<string, string>;
  timeoutMs: number;
  env?: Record<string, string>;
}

/**
 * Runs a non-git program (docs/11 §2.1: only `core/git` and `core/process` spawn processes).
 * Never throws for a failing command.
 */
export interface ProcessRunner {
  run(command: string, args: string[], opts: RunOptions): Promise<ProcessResult>;
}

export function execaRunner(): ProcessRunner {
  return {
    async run(command, args, opts) {
      const cwd = await mkdtemp(join(tmpdir(), "aimem-run-"));
      try {
        for (const [name, text] of Object.entries(opts.files ?? {}))
          await writeFile(join(cwd, name), text, "utf8");
        const r = await execa(command, args, {
          cwd,
          reject: false,
          timeout: opts.timeoutMs,
          ...(opts.input !== undefined ? { input: opts.input } : { stdin: "ignore" as const }),
          ...(opts.env ? { env: opts.env } : {}),
        });
        // On Windows a missing program goes through cmd.exe and exits 1 with this message.
        const notFound =
          (r as { code?: string }).code === "ENOENT" ||
          r.exitCode === undefined ||
          /is not recognized as an internal or external command/i.test(String(r.stderr ?? ""));
        return {
          code: notFound && !r.timedOut ? 127 : (r.exitCode ?? 1),
          stdout: String(r.stdout ?? ""),
          stderr: String(r.stderr || (notFound ? (r.shortMessage ?? "") : "")),
          timedOut: Boolean(r.timedOut),
        };
      } finally {
        await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

/**
 * Start a program that outlives this process (e.g. the vector refresh after a CLI write, T1).
 * Output is discarded and failures are ignored: the caller never waits for it.
 */
export function spawnDetached(command: string, args: string[], cwd: string): void {
  try {
    const child = execa(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      reject: false,
      cleanup: false,
    });
    child.unref();
    // Background work yields the CPU to the person's next command.
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, 10);
      } catch {
        // Not permitted on some systems; the refresh still runs.
      }
    }
    child.catch(() => undefined);
  } catch {
    // A refresh that cannot start is caught up by the next write or `aimem index --embeddings`.
  }
}

/** Runs the GitHub CLI in a directory (\`aimem adopt --sources prs\`); a missing \`gh\` is a failed result. */
export function execaGh(timeoutMs = 60_000) {
  return async (args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> => {
    const r = await execa("gh", args, { cwd, reject: false, timeout: timeoutMs, windowsHide: true });
    if ((r as { code?: string }).code === "ENOENT")
      return { code: 127, stdout: "", stderr: "gh is not installed (https://cli.github.com)" };
    return {
      code: typeof r.exitCode === "number" ? r.exitCode : 1,
      stdout: String(r.stdout ?? ""),
      stderr: String(r.stderr || r.shortMessage || ""),
    };
  };
}
