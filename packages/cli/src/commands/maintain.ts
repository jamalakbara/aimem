import {
  buildVectorCache,
  exitCodeFor,
  fixNotebook,
  loadIndex,
  loadProject,
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
  o: { embeddings?: boolean; rebuild?: boolean } = {},
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const index = await loadIndex(nb, { fs: deps.fs });
  const written = await writeIndexMd(deps.fs, nb, index, deps.random);
  const lines = [
    `${written ? "INDEX.md updated" : "INDEX.md already up to date"} (${index.records.length} records${index.problems.length ? `, ${index.problems.length} unreadable; run aimem validate` : ""}).`,
  ];
  const warnings: string[] = [];
  let embeddings: Record<string, unknown> | undefined;
  if (o.embeddings || o.rebuild) {
    const status = await embeddingStatus(deps, nb, true);
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
    },
    text: `${lines.join("\n")}\n`,
    warnings,
  };
}
