import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  BODY_SECTIONS,
  baseFrontmatterSchema,
  type RecordType,
  recordSchema,
  SPEC_VERSION,
  STATUSES,
  TYPE_DIR,
} from "@aimem/schema";
import { readNotebookFiles } from "../index/build.js";
import type { Clock, Fs } from "../ports.js";
import type { Notebook, ResolvedProject } from "../project/load.js";
import { parseRecordText } from "../records/text.js";
import { loadSecretIgnore, scanSecrets } from "../secrets/scan.js";
import { staticPrefix } from "../util/glob.js";

export type Level = "error" | "warn";

export interface Issue {
  code: string;
  level: Level;
  /** Path relative to the notebook root, `/`-separated. */
  file: string;
  ref?: string;
  line?: number;
  message: string;
}

export interface ValidationInput {
  /** Path relative to the notebook root. */
  file: string;
  /** Type implied by the directory. */
  dirType: RecordType;
  text: string;
}

/** 03 §9 levels. */
export const LEVELS: Record<string, Level> = {
  V001: "error",
  V002: "error",
  V003: "error",
  V004: "error",
  V005: "error",
  V006: "error",
  V007: "error",
  V008: "error",
  V009: "warn",
  V010: "warn",
  V011: "warn",
  V012: "warn",
  V013: "warn",
  V014: "warn",
  V015: "warn",
  V016: "error",
  V017: "warn",
  V018: "warn",
};

/** Statuses meaning "no longer current": no staleness warning (OQ-24). */
export const RETIRED_STATUSES: ReadonlySet<string> = new Set(["superseded", "deprecated", "rejected"]);
const DAY = 86_400_000;

type FM = Record<string, unknown> & {
  id: string;
  type: RecordType;
  title: string;
  summary: string;
  status: string;
  roles: string[];
  created: string;
};

interface Rec {
  input: ValidationInput;
  fm: FM;
  body: string;
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const words = (s: string) => (s.match(/\S+/g) ?? []).length;

/** sha256 of the body with surrounding whitespace trimmed and LF line endings (OQ-25, V017). */
export function contentSha(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n?/g, "\n").trim()).digest("hex");
}

export type Freshness = "fresh" | "stale" | "expired";

/** 03 §3.3, §6: `expires` wins; otherwise the per-type window since `verified` (or `created`). */
export function freshnessOf(
  fm: { type: string; created: string; verified?: unknown; expires?: unknown },
  config: ResolvedProject,
  now: Date,
): Freshness {
  const expires = str(fm.expires);
  if (expires && Date.parse(`${expires}T23:59:59Z`) < now.getTime()) return "expired";
  const window = config.freshness_days[fm.type];
  if (!window) return "fresh";
  const verified = str(fm.verified);
  const base = Date.parse(verified ? `${verified}T00:00:00Z` : fm.created);
  return now.getTime() - base > window * DAY ? "stale" : "fresh";
}

/** V011 path overlap: one glob's literal prefix contains the other's. */
export function pathsOverlapForConflict(a: string[], b: string[]): boolean {
  return a.some((x) =>
    b.some((y) => staticPrefix(x).startsWith(staticPrefix(y)) || staticPrefix(y).startsWith(staticPrefix(x))),
  );
}

/** Run V001–V018 over in-memory files. Pure: no I/O, the clock is passed in. */
export function validateFiles(
  inputs: ValidationInput[],
  config: ResolvedProject,
  now: Date,
  secretIgnore: ReadonlySet<string> = new Set(),
): Issue[] {
  const issues: Issue[] = [];
  const add = (
    input: ValidationInput,
    code: string,
    message: string,
    extra: { ref?: string; line?: number } = {},
  ) => issues.push({ code, level: LEVELS[code] ?? "error", file: input.file, ...extra, message });

  // Pass 1: parse, header shape, version, directory, status. Records failing V001/V002/V016 stop here.
  const recs: Rec[] = [];
  for (const input of inputs) {
    const parsed = parseRecordText(input.text);
    if (!parsed.ok) {
      add(input, "V001", parsed.message);
      continue;
    }
    const data = parsed.record.data;
    const base = baseFrontmatterSchema.safeParse(data);
    if (!base.success) {
      add(
        input,
        "V002",
        base.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
        { ref: str(data.id) },
      );
      continue;
    }
    const fm = data as FM;
    const ref = fm.id;
    if (typeof data.aimem === "number" && data.aimem > SPEC_VERSION) {
      add(input, "V016", `spec v${data.aimem} is newer than supported v${SPEC_VERSION}`, { ref });
      continue;
    }
    const statusOk = (STATUSES[fm.type] as readonly string[]).includes(fm.status);
    const full = recordSchema.safeParse(statusOk ? data : { ...data, status: STATUSES[fm.type][0] });
    if (!full.success) {
      add(input, "V002", full.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), {
        ref,
      });
      continue;
    }
    if (fm.type !== input.dirType)
      add(input, "V003", `type '${fm.type}' does not match directory '${TYPE_DIR[input.dirType]}/'`, { ref });
    if (!statusOk)
      add(
        input,
        "V004",
        `status '${fm.status}' not allowed for ${fm.type} (allowed: ${STATUSES[fm.type].join(", ")})`,
        { ref },
      );
    recs.push({ input, fm, body: parsed.record.body });
  }

  const byId = new Map<string, Rec[]>();
  for (const r of recs) byId.set(r.fm.id, [...(byId.get(r.fm.id) ?? []), r]);
  const roles = new Set(config.roles);
  /** Local id for a ref, or undefined when it points to another project (unreachable until M3). */
  const local = (ref: string): string | undefined => {
    const i = ref.indexOf(":");
    if (i < 0) return ref;
    return ref.slice(0, i) === config.project ? ref.slice(i + 1) : undefined;
  };
  const target = (ref: string | undefined) => (ref ? byId.get(local(ref) ?? "")?.[0] : undefined);

  // Pass 2: per-record rules.
  for (const r of recs) {
    const { fm, body, input } = r;
    const ref = fm.id;
    const at = (code: string, message: string, line?: number) =>
      add(input, code, message, line ? { ref, line } : { ref });

    if ((byId.get(ref)?.length ?? 0) > 1) at("V005", `duplicate id ${ref}`);

    const refs = [
      ...strs(fm.links),
      ...strs(fm.blocked_by),
      ...strs(fm.covers),
      ...[fm.supersedes, fm.superseded_by, fm.task].flatMap((x) => (str(x) ? [x as string] : [])),
    ];
    for (const x of refs) {
      const id = local(x);
      if (id !== undefined && !byId.has(id)) at("V006", `reference to unknown record ${x}`);
    }

    const sup = target(str(fm.supersedes));
    if (sup && local(str(sup.fm.superseded_by) ?? "") !== ref)
      at("V007", `${sup.fm.id} should have superseded_by: ${ref}`);
    const supBy = target(str(fm.superseded_by));
    if (supBy && local(str(supBy.fm.supersedes) ?? "") !== ref)
      at("V007", `${supBy.fm.id} should have supersedes: ${ref}`);

    const scanned = scanSecrets(input.text.replace(/\r\n?/g, "\n"), secretIgnore);
    for (const f of scanned)
      at("V008", `possible secret (${f.kind}) on line ${f.line}; fingerprint ${f.fingerprint}`, f.line);

    if (
      fm.summary.length > 200 ||
      fm.summary.includes("\n") ||
      fm.summary.trim().toLowerCase() === fm.title.trim().toLowerCase()
    ) {
      at("V009", "summary should be one line, ≤ 200 characters, and differ from the title");
    }

    const fresh = freshnessOf(fm, config, now);
    if (fresh !== "fresh" && !RETIRED_STATUSES.has(fm.status)) at("V010", `record is ${fresh}`);

    if (fm.type === "handoff") {
      const missing = BODY_SECTIONS.handoff.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, "m").test(body));
      if (missing.length) at("V012", `handoff missing sections: ${missing.join(", ")}`);
    }
    if (words(body) > 600) at("V013", `body is ${words(body)} words (> 600); consider splitting`);

    const unknownRoles = fm.roles.filter((x) => x !== "all" && !roles.has(x));
    if (unknownRoles.length) at("V014", `unknown roles: ${unknownRoles.join(", ")}`);

    if (!basename(input.file).startsWith(`${ref}-`)) at("V015", `file name should start with ${ref}-`);

    if (fm.managed_by === "external") {
      const source = fm.source as { content_sha?: unknown; state?: unknown } | undefined;
      if (source?.content_sha !== contentSha(body))
        at("V017", "body differs from the imported source (edited locally?)");
      if (source?.state !== "ok") at("V018", `source state is '${String(source?.state)}' at last sync`);
    }
  }

  // V011: accepted decisions with overlapping paths and a shared tag, not linked. Reported on both (OQ-23).
  const accepted = recs.filter((r) => r.fm.type === "decision" && r.fm.status === "accepted");
  for (const [i, a] of accepted.entries()) {
    for (const b of accepted.slice(i + 1)) {
      const sharedTag = strs(a.fm.tags).some((t) => strs(b.fm.tags).includes(t));
      const linked = [a, b].some((x) => {
        const other = x === a ? b : a;
        return [...strs(x.fm.links), str(x.fm.supersedes), str(x.fm.superseded_by)].some(
          (l) => l && local(l) === other.fm.id,
        );
      });
      if (sharedTag && pathsOverlapForConflict(strs(a.fm.paths), strs(b.fm.paths)) && !linked) {
        add(a.input, "V011", `possible conflict with ${b.fm.id} (overlapping paths and tags, no link)`, {
          ref: a.fm.id,
        });
        add(b.input, "V011", `possible conflict with ${a.fm.id} (overlapping paths and tags, no link)`, {
          ref: b.fm.id,
        });
      }
    }
  }
  return issues;
}

/** Validate every record in a notebook. */
export async function validateNotebook(nb: Notebook, deps: { fs: Fs; clock: Clock }): Promise<Issue[]> {
  const inputs = await readNotebookFiles(nb, deps.fs);
  return validateFiles(inputs, nb.config, deps.clock.now(), await loadSecretIgnore(deps.fs, nb.dir));
}

/** 03 §9: 0 ok, 1 warnings only (with --strict), 2 errors. */
export function exitCodeFor(issues: Issue[], strict: boolean): 0 | 1 | 2 {
  if (issues.some((i) => i.level === "error")) return 2;
  if (strict && issues.some((i) => i.level === "warn")) return 1;
  return 0;
}
