import { type Git, nodeFs } from "@aimem/core";
import { type CliDeps, run } from "aimem";

export const FIXTURES = new URL("../../../fixtures/projects/", import.meta.url).pathname;

/** Fake git: a repository where every command succeeds and user.name is unset. Records calls. */
export function fakeGit(userName?: string): Git & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args) {
      calls.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "git version 2.99.0\n", stderr: "" };
      if (args[0] === "rev-parse" && args.includes("--abbrev-ref"))
        return { code: 0, stdout: "main\n", stderr: "" };
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "remote") return { code: 0, stdout: "origin\n", stderr: "" };
      if (args[0] === "config")
        return userName
          ? { code: 0, stdout: `${userName}\n`, stderr: "" }
          : { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Parsed stdout when it is JSON. */
  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary envelope fields
  json: any;
}

export async function cli(args: string[], deps: Partial<CliDeps> = {}): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  let n = 0;
  const code = await run(args, {
    fs: nodeFs,
    clock: { now: () => new Date("2026-10-12T00:00:00Z") },
    random: { bytes: (k) => Uint8Array.from({ length: k }, () => n++ % 256) },
    env: {},
    stdin: async () => "",
    git: fakeGit(),
    loadEmbedder: async () => ({ available: false, reason: "no local model in tests" }),
    cwd: FIXTURES,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    ...deps,
  });
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON of unknown shape
  let json: any;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { code, stdout, stderr, json };
}
