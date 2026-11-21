import { AimemError, loadIndex, loadProject, setProjectValue, writeIndexMd } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { init } from "./init.js";

/**
 * `aimem hub init` (04 §2, 03 §7): create a notebook with `scope: hub` for cross-repo records and
 * print the `hub:` snippet that each member repo adds to its `project.yaml`.
 */
export async function hubInit(
  deps: CliDeps,
  g: GlobalOptions,
  o: { project?: string; repos?: string; force?: boolean; adapters?: string },
): Promise<CommandResult> {
  const repos = o.repos
    ?.split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (o.repos !== undefined && !repos?.length)
    throw new AimemError("USAGE", "--repos needs at least one repo name");
  const created = await init(deps, g, {
    intake: false,
    ...(o.project ? { project: o.project } : {}),
    ...(o.force ? { force: true } : {}),
    ...(o.adapters !== undefined ? { adapters: o.adapters } : {}),
  });
  let nb = await loadProject(deps.fs, g.dir);
  await setProjectValue(deps.fs, nb, ["scope"], "hub", deps.random);
  if (repos)
    await setProjectValue(
      deps.fs,
      nb,
      ["repos"],
      repos.map((name) => ({ name })),
      deps.random,
    );
  nb = await loadProject(deps.fs, g.dir);
  await writeIndexMd(deps.fs, nb, await loadIndex(nb, { fs: deps.fs }), deps.random);
  const origin = await deps.git.run(["remote", "get-url", "origin"], nb.root);
  const url = origin.code === 0 && origin.stdout.trim() ? origin.stdout.trim() : "<url of this hub repo>";
  const snippet = `hub:\n  url: ${url}`;
  const data = created.data as Record<string, unknown>;
  return {
    data: { ...data, scope: "hub", ...(repos ? { repos } : {}), snippet },
    text: `${created.text}\nAdd this to each member repo's .aimem/project.yaml, with the same project slug:\n${snippet}\n`,
    warnings: [
      ...(created.warnings ?? []),
      ...(origin.code === 0 ? [] : ["No origin remote: replace the hub url placeholder in the snippet."]),
    ],
  };
}
