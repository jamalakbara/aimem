import type { RecordType } from "@aimem/schema";

/** Sources named by `aimem adopt --sources` (04, 08 §2.1). */
export const ADOPT_SOURCES = ["readme", "docs", "adr", "agents", "git", "prs", "schema", "ci"] as const;
export type AdoptSource = (typeof ADOPT_SOURCES)[number];

/** Sources with an extractor in this version; the others arrive in later M4 slices (22). */
export const IMPLEMENTED_SOURCES: readonly AdoptSource[] = [
  "adr",
  "agents",
  "readme",
  "ci",
  "schema",
  "git",
  "prs",
  "docs",
];

/** Sources read when `--sources` is not given: everything offline (22 decision 9 keeps `prs` opt-in). */
export const DEFAULT_SOURCES: readonly AdoptSource[] = IMPLEMENTED_SOURCES.filter((s) => s !== "prs");

/** A draft record found by a scan. Nothing is written until the draft phase (22 §4.2). */
export interface AdoptCandidate {
  source: AdoptSource;
  type: RecordType;
  title: string;
  summary: string;
  body: string;
  status?: string;
  /** Memory kind (03 §3.3). */
  kind?: "howto" | "preference" | "fact" | "gotcha";
  tags: string[];
  paths?: string[];
  /** `path` or `path#heading-slug`, relative to the project root, `/` separators (22 decision 2). */
  evidence: string[];
}

export interface AdoptSkip {
  evidence: string;
  reason: string;
}

export interface ScanResult {
  candidates: AdoptCandidate[];
  skipped: AdoptSkip[];
}
