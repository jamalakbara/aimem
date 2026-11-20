import { PROJECT_DEFAULTS } from "@aimem/schema";
import { AimemError } from "../errors.js";
import { loadIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { loadSecretIgnore, scanSecrets } from "../secrets/scan.js";
import { toPosix } from "../util/path.js";
import { mutateClaim } from "./lifecycle.js";
import {
  type ClaimDeps,
  claimConflict,
  claimOwner,
  claimTarget,
  expiry,
  ownsClaim,
  requireOnlineGitClaims,
  type TaskClaim,
  validPaths,
  validTtl,
} from "./model.js";

const TAKEOVER_GRACE_MS = 5 * 60_000;

export interface TaskClaimInput {
  holder: string;
  session?: string;
  paths?: string[];
  note?: string;
  ttlMinutes?: number;
  offline?: boolean;
  steal?: boolean;
}

/** Acquire an exclusive claim without writing any durable notebook records. */
export async function acquireTaskClaim(
  nb: Notebook,
  ref: string,
  input: TaskClaimInput,
  deps: ClaimDeps,
): Promise<TaskClaim> {
  requireOnlineGitClaims(nb, input.offline);
  const target = claimTarget(nb, ref);
  const owner = claimOwner(input.holder, input.session ?? Buffer.from(deps.random.bytes(16)).toString("hex"));
  const started = deps.clock.now().toISOString();
  const ttl = input.ttlMinutes ?? nb.config.claims?.ttl_minutes ?? PROJECT_DEFAULTS.claims.ttl_minutes;
  if (!validTtl(ttl, started))
    throw new AimemError("USAGE", "Claim TTL must be positive whole minutes with a valid expiry.");
  if (input.paths !== undefined && (!validPaths(input.paths) || input.paths.length === 0))
    throw new AimemError("USAGE", "Provide one or more claim paths.");
  const paths = input.paths?.map(toPosix);
  const metadata = [owner.holder, owner.session, ...(paths ?? []), input.note ?? ""].join("\n");
  if (scanSecrets(metadata, await loadSecretIgnore(deps.fs, nb.dir)).length) {
    throw new AimemError("SECRET_DETECTED", "Possible secret in claim metadata. Remove it and retry.");
  }
  const index = await loadIndex(nb, deps);
  if (!index.records.some((record) => record.id === target.id && record.type === "task")) {
    throw new AimemError("NOT_FOUND", "Task ref does not resolve in this notebook.");
  }

  const claim: TaskClaim = {
    task: target.task,
    ...owner,
    started,
    heartbeat: started,
    ttl_minutes: ttl,
    ...(paths === undefined ? {} : { paths }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
  return mutateClaim(nb, target, deps, Boolean(input.steal), (current) => {
    if (current === undefined) {
      if (input.steal) throw new AimemError("NOT_FOUND", "There is no live claim to take over.");
      return { result: claim, change: { claim, message: "aimem: claim task" } };
    }
    const now = deps.clock.now().getTime();
    const expires = expiry(current);
    if (now < expires) {
      if (ownsClaim(current, owner)) return { result: current };
      throw claimConflict(current, `${target.task} is claimed by ${current.holder}.`);
    }
    if (!input.steal) {
      throw claimConflict(
        current,
        `${target.task} has an expired claim. Use --steal to take it over when eligible.`,
      );
    }
    if (now < expires + TAKEOVER_GRACE_MS) {
      throw claimConflict(current, `${target.task} is still within the five-minute clock-skew allowance.`);
    }
    return {
      result: claim,
      change: { claim, message: `aimem: take over task claim\n\nAimem-Previous-Holder: ${current.holder}` },
    };
  });
}
