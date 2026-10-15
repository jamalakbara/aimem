import { nodeFs } from "@aimem/core";
import { type CliDeps, run } from "aimem";

export const FIXTURES = new URL("../../../fixtures/projects/", import.meta.url).pathname;

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
