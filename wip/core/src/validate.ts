import path from "node:path";
import picomatch from "picomatch";
import { BODY_SECTIONS, SPEC_VERSION, STATUSES, TYPE_DIR, isValidId } from "@aimem/schema";
import { freshnessOf } from "./freshness.js";
import { scanSecrets } from "./secrets.js";
import type { LoadProblem, Notebook, Rec } from "./store.js";

export type Level = "error" | "warn";
export interface Issue { code: string; level: Level; ref?: string; file: string; message: string }

const words = (s: string) => (s.match(/\S+/g) ?? []).length;

export function paathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (picomatch(a)(b) || picomatch(b)(a)) return true;
  const stat = (g: string) => g.split(/[*?[{]/)[0] ?? "";
  const sa = stat(a), sb = stat(b);
  return sa.startsWith(sb) || sb.startsWith(sa);
}
export { paathsOverlap as pathsOverlap };

export function validate(nb: Notebook, records: Rec[], problems: LoadProblem[], now = new Date()): Issue[] {
  const issues: Issue[] = [];
  const rel = (f: string) => path.relative(nb.root, f);
  for (const p of problems) issues.push({ code: p.code, level: "error", file: rel(p.file), message: p.message });

  const byId = new Map<string, Rec[]>();
  for (const r of records) byId.set(r.fm.id, [...(byId.get(r.fm.id) ?? []), r]);
  const roles = new Set(nb.config.roles);

  for (const r of records) {
    const { fm } = r;
    const base = { ref: fm.id, file: rel(r.file) };
    const add = (code: string, level: Level, message: string) => issues.push({ code, level, message, ...base });

    if (fm.aimem > SPEC_VERSION) add("V016", "error", `spec v${fm.aimem} is newer than supported v${SPEC_VERSION}`);
    if (r.dirType !== fm.type) add("V003", "error", `type '${fm.type}' does not match directory '${TYPE_DIR[r.dirType]}/'`);
    if (!STATUSES[fm.type].includes(fm.status)) add("V004", "error", `status '${fm.status}' not allowed for ${fm.type} (allowed: ${STATUSES[fm.type].join(", ")})`);
    if ((byId.get(fm.id)?.length ?? 0) > 1) add("V005", "error", `duplicate id ${fm.id}`);

    for (const ref of [...(fm.links ?? []), ...(fm.supersedes ? [fm.supersedes] : []), ...(fm.superseded_by ? [fm.superseded_by] : [])]) {
      const id = ref.includes(":") ? null : ref; // global refs to other projects/hubs: unreachable in M1 → skipped
      if (id && !byId.has(id)) add("V006", "error", `reference to unknown record ${ref}`);
    }
    if (fm.supersedes && !fm.supersedes.includes(":")) {
      const t = byId.get(fm.supersedes)?.[0];
      if (t && t.fm.superseded_by !== fm.id) add("V007", "error", `${fm.supersedes} should have superseded_by: ${fm.id}`);
    }
    if (fm.superseded_by && !fm.superseded_by.includes(":")) {
      const t = byId.get(fm.superseded_by)?.[0];
      if (t && t.fm.supersedes !== fm.id) add("V007", "error", `${fm.superseded_by} should have supersedes: ${fm.id}`);
    }
    const secrets = scanSecrets(`${fm.title}\n${fm.summary}\n${r.body}`);
    if (secrets.length) add("V008", "error", `possible secret in record (${secrets.join(", ")})`);

    if (fm.summary.length > 200 || fm.summary.trim().toLowerCase() === fm.title.trim().toLowerCase() || /\n/.test(fm.summary)) {
      add("V009", "warn", "summary should be one line, ≤ 200 chars, and differ from the title");
    }
    const fr = freshnessOf(r, nb.config, now);
    if (fr !== "fresh" && !["superseded", "rejected", "deprecated"].includes(fm.status)) add("V010", "warn", `record is ${fr}`);
    if (fm.type === "handoff") {
      const missing = BODY_SECTIONS.handoff.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, "mi").test(r.body));
      if (missing.length) add("V012", "warn", `handoff missing sections: ${missing.join(", ")}`);
    }
    if (words(r.body) > 600) add("V013", "warn", `body is ${words(r.body)} words (> 600); consider splitting`);
    const unknownRoles = fm.roles.filter((x) => x !== "all" && !roles.has(x));
    if (unknownRoles.length) add("V014", "warn", `unknown roles: ${unknownRoles.join(", ")}`);
    if (!isValidId(fm.id) || !path.basename(r.file).startsWith(`${fm.id}-`)) add("V015", "warn", "file name does not start with the record id");
  }

  // V011: overlapping accepted decisions without a supersede link
  const acc = records.filter((r) => r.fm.type === "decision" && r.fm.status === "accepted");
  for (let i = 0; i < acc.length; i++) for (let j = i + 1; j < acc.length; j++) {
    const a = acc[i]!, b = acc[j]!;
    const pa = a.fm.paths ?? [], pb = b.fm.paths ?? [];
    const sharedTag = (a.fm.tags ?? []).some((t) => (b.fm.tags ?? []).includes(t));
    const overlap = pa.some((x) => pb.some((y) => paathsOverlap(x, y)));
    const linked = (a.fm.links ?? []).includes(b.fm.id) || (b.fm.links ?? []).includes(a.fm.id);
    if (overlap && sharedTag && !linked) {
      issues.push({ code: "V011", level: "warn", ref: a.fm.id, file: rel(a.file), message: `possible conflict with ${b.fm.id} (overlapping paths and tags, no link)` });
    }
  }
  return issues;
}

export function exitCodeFor(issues: Issue[], strict: boolean): number {
  if (issues.some((i) => i.level === "error")) return 2;
  if (strict && issues.some((i) => i.level === "warn")) return 1;
  return 0;
}
