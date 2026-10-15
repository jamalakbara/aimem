import {
  AimemError,
  buildBriefing,
  gitChangedFiles,
  gitDiagnostics,
  loadIndex,
  loadProject,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { table } from "../output.js";

export interface ContextOptions {
  task?: string;
  ref?: string;
  paths?: string[];
  role?: string;
  budget?: number;
  format: string;
  includeSuperseded?: boolean;
  live?: boolean;
  explain?: boolean;
  mode: string;
  deep?: boolean;
}

/** `aimem context` (04 §3, 06 §2). */
export async function context(deps: CliDeps, g: GlobalOptions, o: ContextOptions): Promise<CommandResult> {
  if (o.format !== "md" && o.format !== "json")
    throw new AimemError("USAGE", `--format must be md or json (got '${o.format}')`);
  if (o.mode !== "lexical" && o.mode !== "hybrid")
    throw new AimemError("USAGE", `--mode must be lexical or hybrid (got '${o.mode}')`);
  const warnings: string[] = [];
  if (o.mode === "hybrid") warnings.push("hybrid retrieval is not available yet (slice 2.3); using lexical");
  if (o.deep) warnings.push("--deep is not defined yet (see docs/14 OQ-30); ignored");

  const nb = await loadProject(deps.fs, g.dir);
  const index = await loadIndex(nb, { fs: deps.fs });
  const paths = (o.paths ?? [])
    .flatMap((p) => p.split(","))
    .map((p) => p.trim())
    .filter(Boolean);
  const { branch } = await gitDiagnostics(deps.git, nb.root);
  const inferPaths = !o.task && !o.ref && !paths.length;
  const usedPaths = inferPaths ? await gitChangedFiles(deps.git, nb.root) : paths;
  const b = buildBriefing(
    nb,
    index,
    {
      ...(o.task ? { task: o.task } : {}),
      ...(o.ref ? { ref: o.ref } : {}),
      ...(usedPaths.length ? { paths: usedPaths } : {}),
      ...(o.role ? { role: o.role } : {}),
      ...(o.budget !== undefined ? { budget: o.budget } : {}),
      ...(o.includeSuperseded ? { includeSuperseded: true } : {}),
      ...(branch ? { branch } : {}),
    },
    deps.clock.now(),
  );
  const data = {
    ...b,
    ...(inferPaths ? { inferred: { paths: usedPaths, ...(branch ? { branch } : {}) } } : {}),
  };
  let text = o.format === "json" ? `${JSON.stringify(data, null, 2)}\n` : b.markdown;
  if (o.explain && o.format === "md") {
    const rows = b.explain.map((e) => [
      e.ref,
      e.section,
      e.pin ?? "",
      e.parts.total.toFixed(3),
      e.parts.lexical.toFixed(2),
      String(e.parts.paths),
      String(e.parts.links),
      e.parts.recency.toFixed(2),
      String(e.parts.typeBoost),
      String(e.parts.roleMatch),
      String(e.parts.trust),
      String(e.parts.freshness),
    ]);
    text += `\n--- explain (not part of the briefing) ---\n${table(["REF", "SECTION", "PIN", "TOTAL", "LEX", "PATHS", "LINKS", "RECENCY", "TYPE", "ROLE", "TRUST", "FRESH"], rows)}`;
  }
  return { data, text, warnings };
}
