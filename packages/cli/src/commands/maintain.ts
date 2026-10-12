import { exitCodeFor, loadIndex, loadProject, validateNotebook, writeIndexMd } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

export async function validateCmd(
  deps: CliDeps,
  g: GlobalOptions,
  o: { strict?: boolean },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const issues = await validateNotebook(nb, { fs: deps.fs, clock: deps.clock });
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const data = { errors, warnings, issues };
  const exitCode = exitCodeFor(issues, Boolean(o.strict));
  const text = issues.length
    ? `${issues.map((i) => `${i.level} ${i.code} ${i.file}${i.line ? `:${i.line}` : ""} — ${i.message}`).join("\n")}\n${errors} errors, ${warnings} warnings\n`
    : "No issues.\n";
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

export async function indexCmd(deps: CliDeps, g: GlobalOptions): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const index = await loadIndex(nb, { fs: deps.fs });
  const written = await writeIndexMd(deps.fs, nb, index, deps.random);
  return {
    data: { written, records: index.records.length, problems: index.problems },
    text: `${written ? "INDEX.md updated" : "INDEX.md already up to date"} (${index.records.length} records${index.problems.length ? `, ${index.problems.length} unreadable; run aimem validate` : ""}).\n`,
  };
}
