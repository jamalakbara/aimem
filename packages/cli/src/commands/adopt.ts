import {
  ADOPT_SOURCES,
  type AdoptCandidate,
  type AdoptSource,
  AimemError,
  applyWritePolicy,
  IMPLEMENTED_SOURCES,
  loadProject,
  loadSecretIgnore,
  resolveAuthorWithGit,
  scanProject,
  writeAdoptDrafts,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { writeDeps } from "./embedder.js";

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
 * `aimem adopt` (08 §2, 22 §4.1–4.2). `--dry-run` lists the draft candidates with their evidence;
 * otherwise they are written as `trust: inferred` records and `write_policy` applies once for the run.
 */
export async function adopt(
  deps: CliDeps,
  g: GlobalOptions,
  o: { dryRun?: boolean; sources?: string; maxRecords?: number; author?: string },
): Promise<CommandResult> {
  const requested = o.sources
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const s of requested ?? [])
    if (!(ADOPT_SOURCES as readonly string[]).includes(s))
      throw new AimemError("USAGE", `unknown source '${s}'; use ${ADOPT_SOURCES.join(", ")}`);
  const nb = await loadProject(deps.fs, g.dir);
  const warnings = (requested ?? [])
    .filter((s) => !IMPLEMENTED_SOURCES.includes(s as AdoptSource))
    .map((s) => `source ${s} is not implemented yet (later M4 slices); skipped`);
  const sources = IMPLEMENTED_SOURCES.filter((s) => !requested || requested.includes(s));
  const result = await scanProject(deps.fs, nb.root, {
    sources,
    secretIgnore: await loadSecretIgnore(deps.fs, nb.dir),
  });
  if (!o.dryRun) return write(deps, g, o, nb, result, sources, warnings);
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

async function write(
  deps: CliDeps,
  g: GlobalOptions,
  o: { maxRecords?: number; author?: string },
  nb: Awaited<ReturnType<typeof loadProject>>,
  scan: Awaited<ReturnType<typeof scanProject>>,
  sources: AdoptSource[],
  warnings: string[],
): Promise<CommandResult> {
  const author = await resolveAuthorWithGit({
    ...(o.author ? { flag: o.author } : {}),
    env: deps.env,
    git: deps.git,
    cwd: g.dir,
  });
  const r = await writeAdoptDrafts(
    nb,
    scan.candidates,
    { author, ...(o.maxRecords !== undefined ? { maxRecords: o.maxRecords } : {}) },
    await writeDeps(deps, nb),
  );
  const n = r.written.length;
  // 22 decision 3: one commit (or branch) for the whole run, not one per record.
  const policy = n
    ? await applyWritePolicy({
        git: deps.git,
        nb,
        author,
        files: r.changed,
        message: `aimem: adopt ${n} record${n === 1 ? "" : "s"}`,
      })
    : { action: "none" as const, warnings: [] };
  for (const s of scan.skipped) warnings.push(`skipped ${s.evidence}: ${s.reason}`);
  warnings.push(...r.warnings, ...policy.warnings);

  const lines: string[] = [];
  if (n) {
    lines.push(`Adopted ${n} record${n === 1 ? "" : "s"} (trust: inferred, tag adopted):`);
    for (const w of r.written) lines.push(`  ${w.ref}  ${w.type}  ${w.title}  ${w.evidence.join(", ")}`);
  } else
    lines.push(
      r.alreadyAdopted
        ? `Nothing new to adopt; ${r.alreadyAdopted} candidate${r.alreadyAdopted === 1 ? " is" : "s are"} already adopted.`
        : "Nothing to adopt from these sources.",
    );
  if (r.cut)
    lines.push(
      "",
      `${r.cut} more candidate${r.cut === 1 ? " was" : "s were"} left out by --max-records ${o.maxRecords ?? 40}; run aimem adopt again to add them, or raise the limit.`,
    );
  if (r.held.length) {
    lines.push("", "Not written:");
    for (const h of r.held) lines.push(`  ${h.title} (${h.evidence}): ${h.reason}`);
  }
  if (r.sourceChanged.length) {
    lines.push("", "Source changed since adoption (records left as they are; update them by hand):");
    for (const c of r.sourceChanged) lines.push(`  ${c.ref}  ${c.evidence.join(", ")}`);
  }
  if (n)
    lines.push(
      "",
      "Next: review the drafts with aimem list --trust inferred, then aimem verify <ref> or edit them.",
    );
  return {
    data: {
      dryRun: false,
      sources,
      written: r.written,
      alreadyAdopted: r.alreadyAdopted,
      sourceChanged: r.sourceChanged,
      held: r.held,
      cut: r.cut,
      skipped: scan.skipped,
      git: policy.action,
    },
    text: `${lines.join("\n")}\n`,
    warnings,
  };
}
