import { AimemError, acquireTaskClaim, loadProject, resolveAuthorWithGit } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

export async function taskClaim(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: { author?: string; session?: string; paths?: string; note?: string; ttl?: string; offline?: boolean },
): Promise<CommandResult> {
  if (o.ttl !== undefined && !/^\d+m$/.test(o.ttl)) {
    throw new AimemError("USAGE", "Claim TTL must be given in whole minutes, for example 180m.");
  }
  const nb = await loadProject(deps.fs, g.dir);
  const holder = await resolveAuthorWithGit({
    ...(o.author ? { flag: o.author } : {}),
    env: deps.env,
    git: deps.git,
    cwd: nb.root,
  });
  const session = o.session ?? deps.env.AIMEM_SESSION;
  const paths = o.paths
    ?.split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  const claim = await acquireTaskClaim(
    nb,
    ref,
    {
      holder,
      ...(session === undefined ? {} : { session }),
      ...(paths === undefined ? {} : { paths }),
      ...(o.note === undefined ? {} : { note: o.note }),
      ...(o.ttl === undefined ? {} : { ttlMinutes: Number(o.ttl.slice(0, -1)) }),
      ...(o.offline ? { offline: true } : {}),
    },
    deps,
  );
  return {
    data: { claim },
    text: `Claimed ${claim.task} for ${claim.holder} (session ${claim.session}).\n`,
  };
}
