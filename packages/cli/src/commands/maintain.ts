import { join } from "node:path";
import {
  buildVectorCache,
  exitCodeFor,
  fixNotebook,
  loadIndex,
  loadProject,
  type Notebook,
  validateNotebook,
  writeIndexMd,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { embeddingStatus } from "./embedder.js";

export async function validateCmd(
  deps: CliDeps,
  g: GlobalOptions,
  o: { strict?: boolean; fix?: boolean },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const fix = o.fix
    ? await fixNotebook(nb, { fs: deps.fs, clock: deps.clock, random: deps.random })
    : undefined;
  const issues = await validateNotebook(nb, { fs: deps.fs, clock: deps.clock });
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const data = { errors, warnings, issues, ...(fix ? { fixed: fix.fixed, skipped: fix.skipped } : {}) };
  const fixLines = fix
    ? [
        ...fix.fixed.map((f) => `fixed ${f.code} ${f.file} — ${f.action}`),
        ...fix.skipped.map((s) => `skipped ${s.code} ${s.file} — ${s.reason}`),
      ]
    : [];
  const fixText = fixLines.length ? `${fixLines.join("\n")}\n` : "";
  const exitCode = exitCodeFor(issues, Boolean(o.strict));
  const report = issues.length
    ? `${issues.map((i) => `${i.level} ${i.code} ${i.file}${i.line ? `:${i.line}` : ""} — ${i.message}`).join("\n")}\n${errors} errors, ${warnings} warnings\n`
    : "No issues.\n";
  const text = fixText + report;
  return {
    data,
    text,
    exitCode,
    warnings: issues.filter((i) => i.level === "warn").map((i) => `${i.code} ${i.file}: ${i.message}`),
    ...(errors
      ? {
          failure: {
            code: "INVALID_RECORD",
            message: `${errors} errors, ${warnings} warnings`,
            details: data,
          },
        }
      : {}),
  };
}

export async function indexCmd(
  deps: CliDeps,
  g: GlobalOptions,
  o: {
    embeddings?: boolean;
    rebuild?: boolean;
    reranker?: boolean;
    background?: boolean;
    noDownload?: boolean;
  } = {},
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  if (o.background) return backgroundRefresh(deps, g, nb);
  const index = await loadIndex(nb, { fs: deps.fs });
  const written = await writeIndexMd(deps.fs, nb, index, deps.random);
  const lines = [
    `${written ? "INDEX.md updated" : "INDEX.md already up to date"} (${index.records.length} records${index.problems.length ? `, ${index.problems.length} unreadable; run aimem validate` : ""}).`,
  ];
  const warnings: string[] = [];
  let reranker: { available: boolean; provider?: string; reason?: string } | undefined;
  if (o.reranker) {
    const status = await deps.loadRanker?.(true);
    reranker = status?.available
      ? { available: true, provider: status.provider.id }
      : { available: false, reason: status?.reason ?? "no local ranker loader" };
    lines.push(`Reranker: ${reranker.available ? reranker.provider : "unavailable"}.`);
    if (!reranker.available) warnings.push("cross-encoder unavailable; original retrieval still works");
  }
  let embeddings: Record<string, unknown> | undefined;
  if (o.embeddings || o.rebuild) {
    const status = await embeddingStatus(deps, nb, !o.noDownload);
    if (!status.available) {
      embeddings = { available: false, reason: status.reason };
      warnings.push(`semantic search is off: ${status.reason}; keyword search still works`);
      lines.push(`Embeddings: unavailable (${status.reason}).`);
    } else {
      const r = await buildVectorCache(
        nb,
        index,
        status.provider,
        { fs: deps.fs, random: deps.random },
        { rebuild: Boolean(o.rebuild) },
      );
      embeddings = { available: true, ...r };
      lines.push(
        `Embeddings (${r.provider}): ${r.chunks} chunks, ${r.built} embedded, ${r.reused} reused, ${r.removed} removed${r.rebuilt && r.reason ? ` — full rebuild: ${r.reason}` : ""}.`,
      );
      for (const e of r.excluded) lines.push(`  not embedded: ${e.ref} (${e.reason})`);
    }
  }
  return {
    data: {
      written,
      records: index.records.length,
      problems: index.problems,
      ...(embeddings ? { embeddings } : {}),
      ...(reranker ? { reranker } : {}),
    },
    text: `${lines.join("\n")}\n`,
    warnings,
  };
}

/** A lock older than this belongs to a crashed refresh and is ignored. */
const LOCK_STALE_MS = 10 * 60_000;
const MAX_PASSES = 10;

/**
 * `aimem index --embeddings --background` (T1): the refresh a CLI write starts. One run at a time per
 * notebook: a run that finds a fresh lock leaves a `pending` marker, and the running one repeats
 * once more for it. Never downloads a model.
 */
async function backgroundRefresh(deps: CliDeps, g: GlobalOptions, nb: Notebook): Promise<CommandResult> {
  const cache = join(nb.dir, ".cache");
  const lock = join(cache, "embed-refresh.lock");
  const pending = join(cache, "embed-refresh.pending");
  const exists = (p: string) =>
    deps.fs.readFile(p).then(
      () => true,
      () => false,
    );
  const age = await deps.fs.stat?.(lock).then(
    (s) => deps.clock.now().getTime() - s.mtimeMs,
    () => undefined,
  );
  if (age !== undefined && age < LOCK_STALE_MS) {
    await deps.fs.writeFile(pending, "");
    return { data: { queued: true }, text: "A vector refresh is already running; queued another pass.\n" };
  }
  await deps.fs.mkdir(cache);
  let passes = 0;
  let last: CommandResult | undefined;
  // A write may queue a pass just as this run finishes, so look for `pending` again after the lock
  // is released and take the lock back if needed. At most MAX_PASSES passes per run.
  for (;;) {
    await deps.fs.writeFile(lock, deps.clock.now().toISOString());
    try {
      do {
        await deps.fs.unlink(pending).catch(() => undefined);
        last = await indexCmd(deps, g, { embeddings: true, noDownload: true });
        passes++;
      } while (passes < MAX_PASSES && (await exists(pending)));
    } finally {
      await deps.fs.unlink(lock).catch(() => undefined);
    }
    if (passes >= MAX_PASSES || !(await exists(pending))) break;
  }
  return {
    ...(last as CommandResult),
    data: { ...((last as CommandResult).data as Record<string, unknown>), passes },
  };
}
