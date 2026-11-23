import type {
  Clock,
  EmbeddingProvider,
  EmbeddingStatus,
  Fs,
  Git,
  LlmStatus,
  LocalRanker,
  Random,
  ResolvedProject,
} from "@aimem/core";

/** Everything the CLI touches, injected so commands run in-process in tests (docs/11 §3). */
export interface CliDeps {
  fs: Fs;
  clock: Clock;
  random: Random;
  env: Record<string, string | undefined>;
  cwd: string;
  /** Resolved running binary path; only used for development-build diagnostics. */
  cliEntry?: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Whole standard input, for `--body -`. */
  stdin: () => Promise<string>;
  /** Asks one question on an interactive terminal; `undefined` at end of input. Absent without a TTY (bin only). */
  prompt?: (question: string) => Promise<string | undefined>;
  /** Opens a file in the person's editor and resolves when it closes (`aimem review` e; bin only). */
  edit?: (file: string) => Promise<void>;
  git: Git;
  /** Network access for connectors (bin only; tests inject a simulated service). */
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  /** Waits between retries; tests inject one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
  /** Runs the GitHub CLI in a directory, for \`adopt --sources prs\` (bin only; tests inject a fake). */
  gh?: (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Embedding provider when one is installed (the local model arrives in slice 2.4; tests inject a stub). */
  embedder?: EmbeddingProvider;
  /** Loads the configured provider (local model or remote endpoint). Only `index --embeddings` may download. */
  loadEmbedder?: (config: ResolvedProject, allowDownload: boolean) => Promise<EmbeddingStatus>;
  /** Builds the configured LLM provider for `ask` (15 §11); tests inject a fake. */
  loadLlm?: (config: ResolvedProject) => LlmStatus;
  loadRanker?: (
    allowDownload: boolean,
  ) => Promise<{ available: true; provider: LocalRanker } | { available: false; reason: string }>;
  /** Starts `aimem <args>` detached, so a write does not wait for the embedding model (T1; bin only). */
  spawnBackground?: (args: string[], cwd: string) => void;
  /** Set by `run`: ask for a background vector refresh of a notebook once the command has finished. */
  scheduleVectorRefresh?: (root: string) => void;
  /** Runs the MCP server on this process's stdio until the client disconnects (bin only). */
  serveMcp?: () => Promise<void>;
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
