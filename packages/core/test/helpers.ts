import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Random } from "@aimem/core";

export const FIXTURES = new URL("../../../fixtures/projects/", import.meta.url).pathname;

/** All record files (.md under .aimem/<dir>/) of a fixture, absolute paths, sorted. */
export function fixtureRecordFiles(name: string): string[] {
  const aimem = join(FIXTURES, name, ".aimem");
  const out: string[] = [];
  for (const d of readdirSync(aimem)) {
    const dir = join(aimem, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".md")) out.push(join(dir, f));
  }
  return out.sort();
}

export const read = (p: string) => readFileSync(p, "utf8");

/** Deterministic Random: yields the given bytes cyclically. */
export function fixedRandom(...bytes: number[]): Random {
  let i = 0;
  return {
    bytes(n: number) {
      const a = new Uint8Array(n);
      for (let k = 0; k < n; k++) a[k] = bytes[i++ % bytes.length] ?? 0;
      return a;
    },
  };
}
