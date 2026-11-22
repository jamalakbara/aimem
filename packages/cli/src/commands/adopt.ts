import {
  ADOPT_SOURCES,
  type AdoptCandidate,
  type AdoptSource,
  AimemError,
  IMPLEMENTED_SOURCES,
  loadProject,
  loadSecretIgnore,
  scanProject,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

/** Candidate as printed by `--json`: everything but the body. */
const summary = (c: AdoptCandidate) => ({
  source: c.source,
  type: c.type,
  title: c.title,
  summary: c.summary,
  ...(c.status ? { status: c.status } : {}),
  ...(c.kind ? { kind: c.kind } : {}),
  tags: c.tags,
  ...(c.paths ? { paths: c.paths } : {}),
  evidence: c.evidence,
});

/**
 * `aimem adopt` (08 §2, 22 §4.1). This slice scans only: `--dry-run` lists the draft candidates with
 * their evidence. Writing drafts arrives in 4.2.
 */
export async function adopt(
  deps: CliDeps,
  g: GlobalOptions,
  o: { dryRun?: boolean; sources?: string },
): Promise<CommandResult> {
  const requested = o.sources
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const s of requested ?? [])
    if (!(ADOPT_SOURCES as readonly string[]).includes(s))
      throw new AimemError("USAGE", `unknown source '${s}'; use ${ADOPT_SOURCES.join(", ")}`);
  if (!o.dryRun)
    throw new AimemError(
      "USAGE",
      "only --dry-run is available in this version: writing adopted drafts arrives in M4.2; run aimem adopt --dry-run",
    );
  const nb = await loadProject(deps.fs, g.dir);
  const warnings = (requested ?? [])
    .filter((s) => !IMPLEMENTED_SOURCES.includes(s as AdoptSource))
    .map((s) => `source ${s} is not implemented yet (later M4 slices); skipped`);
  const sources = IMPLEMENTED_SOURCES.filter((s) => !requested || requested.includes(s));
  const result = await scanProject(deps.fs, nb.root, {
    sources,
    secretIgnore: await loadSecretIgnore(deps.fs, nb.dir),
  });
  const counts: Record<string, number> = {};
  for (const c of result.candidates) counts[c.source] = (counts[c.source] ?? 0) + 1;
  for (const s of result.skipped) warnings.push(`skipped ${s.evidence}: ${s.reason}`);

  const lines = [
    `${result.candidates.length} candidate${result.candidates.length === 1 ? "" : "s"} (dry run; nothing written)`,
  ];
  for (const source of sources) {
    const group = result.candidates.filter((c) => c.source === source);
    if (!group.length) continue;
    lines.push("", `${source} (${group.length})`);
    for (const c of group)
      lines.push(`  ${c.type}  ${c.status ?? c.kind ?? ""}  ${c.title}  ${c.evidence.join(", ")}`);
  }
  if (!result.candidates.length) lines.push("Nothing to adopt from these sources.");
  return {
    data: {
      dryRun: true,
      sources,
      counts,
      candidates: result.candidates.map(summary),
      skipped: result.skipped,
    },
    text: `${lines.join("\n")}\n`,
    warnings,
  };
}
