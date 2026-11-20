import {
  AimemError,
  acquireClaim,
  heartbeatTaskClaim,
  type LiveClaim,
  loadProject,
  readLiveClaims,
  releaseTaskClaim,
  resolveAuthorWithGit,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

interface ClaimOptions {
  author?: string;
  session?: string;
  offline?: boolean;
}

function claimLabel(claim: LiveClaim): string {
  return "task" in claim ? claim.task : `${claim.id} (${claim.paths.join(", ")})`;
}

async function claimIdentity(deps: CliDeps, root: string, o: ClaimOptions) {
  const holder = await resolveAuthorWithGit({
    ...(o.author ? { flag: o.author } : {}),
    env: deps.env,
    git: deps.git,
    cwd: root,
  });
  const session = o.session ?? deps.env.AIMEM_SESSION;
  return { holder, ...(session === undefined ? {} : { session }), ...(o.offline ? { offline: true } : {}) };
}

export async function taskClaim(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string | undefined,
  o: ClaimOptions & { paths?: string; note?: string; ttl?: string; steal?: boolean },
): Promise<CommandResult> {
  if (o.ttl !== undefined && !/^\d+m$/.test(o.ttl)) {
    throw new AimemError("USAGE", "Claim TTL must be given in whole minutes, for example 180m.");
  }
  const nb = await loadProject(deps.fs, g.dir);
  const paths = o.paths
    ?.split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  const { claim, overlaps, warnings } = await acquireClaim(
    nb,
    ref,
    {
      ...(await claimIdentity(deps, nb.root, o)),
      ...(paths === undefined ? {} : { paths }),
      ...(o.note === undefined ? {} : { note: o.note }),
      ...(o.ttl === undefined ? {} : { ttlMinutes: Number(o.ttl.slice(0, -1)) }),
      ...(o.steal ? { steal: true } : {}),
    },
    deps,
  );
  return {
    data: { claim, overlaps },
    text: `Claimed ${claimLabel(claim)} for ${claim.holder} (session ${claim.session}).\n`,
    warnings,
  };
}

export async function taskHeartbeat(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: ClaimOptions,
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const claim = await heartbeatTaskClaim(nb, ref, await claimIdentity(deps, nb.root, o), deps);
  return { data: { claim }, text: `Extended the claim for ${claimLabel(claim)} at ${claim.heartbeat}.\n` };
}

export async function taskRelease(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: ClaimOptions,
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const released = await releaseTaskClaim(nb, ref, await claimIdentity(deps, nb.root, o), deps);
  return {
    data: { released },
    text: released ? `Released the claim for ${ref}.\n` : `No live claim for ${ref}.\n`,
  };
}

export async function liveClaims(
  deps: CliDeps,
  g: GlobalOptions,
  o: { offline?: boolean },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const { claims, warnings } = await readLiveClaims(nb, Boolean(o.offline), deps);
  const lines = claims.map((claim) => {
    const status = claim.expired ? "possibly abandoned" : "active";
    return `${claimLabel(claim)}  ${claim.holder}  ${status}  (expires ${claim.expiresAt})`;
  });
  return {
    data: { claims },
    text: lines.length ? `${lines.join("\n")}\n` : "No live claims.\n",
    warnings,
  };
}
