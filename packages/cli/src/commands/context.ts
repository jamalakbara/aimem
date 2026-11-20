import {
  AimemError,
  buildBriefing,
  buildQuery,
  type ContextInput,
  contextWithRewrites,
  gitChangedFiles,
  gitDiagnostics,
  heartbeatSessionClaims,
  loadIndex,
  loadProject,
  readLiveState,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { table } from "../output.js";
import { retrievalDeps } from "./retrieval.js";
import { retrievalMode, semanticFor } from "./semantic.js";
import { currentAuthor } from "./session.js";

export interface ContextOptions {
  task?: string;
  ref?: string;
  paths?: string[];
  role?: string;
  budget?: number;
  format: string;
  includeSuperseded?: boolean;
  live?: boolean;
  session?: string;
  explain?: boolean;
  mode?: string;
  deep?: boolean;
}

/** `aimem context` (04 §3, 06 §2). */
export async function context(deps: CliDeps, g: GlobalOptions, o: ContextOptions): Promise<CommandResult> {
  if (o.format !== "md" && o.format !== "json")
    throw new AimemError("USAGE", `--format must be md or json (got '${o.format}')`);
  const warnings: string[] = [];
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
  const input: ContextInput = {
    ...(o.task ? { task: o.task } : {}),
    ...(o.ref ? { ref: o.ref } : {}),
    ...(usedPaths.length ? { paths: usedPaths } : {}),
    ...(o.role ? { role: o.role } : {}),
    ...(o.budget !== undefined ? { budget: o.budget } : {}),
    ...(o.includeSuperseded ? { includeSuperseded: true } : {}),
    ...(branch ? { branch } : {}),
  };
  // 06 §2.2 step 7: one live fetch per briefing; a failure is shown, never thrown.
  const live = await readLiveState(nb, deps, { skip: o.live === false });
  const holder = live.status === "off" ? undefined : await currentAuthor(deps, nb.root);
  input.live = live;
  if (holder) input.liveHolder = holder;
  const mode = retrievalMode(nb, o.mode);
  const sem = await semanticFor(deps, nb, index, buildQuery(nb, index, input), mode, o.mode !== undefined);
  warnings.push(...sem.warnings);
  const retrievalInput = {
    ...input,
    ...(sem.semantic ? { semantic: sem.semantic } : { semanticOff: sem.off ?? "off" }),
  };
  const retrieved = await contextWithRewrites(
    nb,
    index,
    retrievalInput,
    deps.clock.now(),
    await retrievalDeps(deps, nb, index, mode),
  );
  warnings.push(...retrieved.warnings);
  const b = buildBriefing(nb, index, retrievalInput, deps.clock.now(), retrieved.scored);
  // 06 §2.2 step 11: extend this session's claims, at most every 20 minutes.
  const session = o.session ?? deps.env.AIMEM_SESSION;
  if (holder) {
    const beat = await heartbeatSessionClaims(nb, live, { holder, ...(session ? { session } : {}) }, deps);
    warnings.push(...beat.warnings);
  }
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
