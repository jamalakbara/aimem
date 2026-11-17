import { AimemError, loadIndex, loadProject, recordUsage } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

export async function usageRecord(
  deps: CliDeps,
  g: GlobalOptions,
  args: unknown[],
  o: { session?: string; refs?: string },
): Promise<CommandResult> {
  if (args[0] !== "record") throw new AimemError("USAGE", "usage supports only: record");
  if (!o.session || !o.refs) throw new AimemError("USAGE", "usage record requires --session and --refs");
  const nb = await loadProject(deps.fs, g.dir);
  const result = await recordUsage(
    nb,
    await loadIndex(nb, { fs: deps.fs }),
    { session: o.session, refs: o.refs.split(",").map((s) => s.trim()) },
    deps,
  );
  return {
    data: { recorded: true, ...result },
    text: `Recorded ${result.entry.refs.length} refs in ${result.file}.\n`,
  };
}
