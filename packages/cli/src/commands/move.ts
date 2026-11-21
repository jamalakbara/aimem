import { AimemError, applyWritePolicy, loadProject, moveRecord, resolveAuthorWithGit } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { sourceDeps } from "./sources.js";

/** `aimem move <ref> --to hub|<repo>` (04 §4): both notebooks follow their write_policy. */
export async function move(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: { to?: string; author?: string },
): Promise<CommandResult> {
  const to = o.to?.trim();
  if (!to) throw new AimemError("USAGE", "pass --to hub or a repo name");
  const who = await resolveAuthorWithGit({
    ...(o.author ? { flag: o.author } : {}),
    env: deps.env,
    git: deps.git,
    cwd: g.dir,
  });
  const nb = await loadProject(deps.fs, g.dir);
  const r = await moveRecord(nb, ref, to, { ...sourceDeps(deps), clock: deps.clock, random: deps.random });
  const message = `aimem: move ${r.ref} to ${r.to}`;
  const target = await loadProject(deps.fs, r.targetRoot);
  const there = await applyWritePolicy({
    git: deps.git,
    nb: target,
    author: who,
    files: r.targetChanged,
    message,
  });
  const here = await applyWritePolicy({ git: deps.git, nb, author: who, files: r.changed, message });
  return {
    data: {
      ref: r.ref,
      to: r.to,
      changed: r.changed,
      target: { changed: r.targetChanged, git: there.action },
      git: here.action,
    },
    text: `Moved ${r.ref} to ${r.to}; ${r.changed[0]} is now a pointer stub.\n`,
    warnings: [...there.warnings, ...here.warnings],
  };
}
