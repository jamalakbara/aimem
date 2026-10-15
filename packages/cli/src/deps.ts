import type { Clock, Fs, Random } from "@aimem/core";

/** Everything the CLI touches, injected so commands run in-process in tests (docs/11 §3). */
export interface CliDeps {
  fs: Fs;
  clock: Clock;
  random: Random;
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Whole standard input, for `--body -`. */
  stdin: () => Promise<string>;
}

export interface GlobalOptions {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  /** Absolute start directory (`--dir`, default cwd). */
  dir: string;
}

/** What a command returns; `run` turns it into the 04 §7 envelope or human text. */
export interface CommandResult {
  data: unknown;
  /** Human-readable output (stdout) when not in --json mode. */
  text: string;
  warnings?: string[];
  exitCode?: number;
  /** Set when the command failed but still has output to show (e.g. validate with errors). */
  failure?: { code: string; message: string; details?: Record<string, unknown> };
}
