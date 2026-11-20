import { PROJECT_DEFAULTS } from "@aimem/schema";
import { AimemError } from "../errors.js";
import { loadIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { loadSecretIgnore, scanSecrets } from "../secrets/scan.js";
import { mutateClaim } from "./lifecycle.js";
import {
  type ClaimDeps,
  type ClaimOwner,
  claimConflict,
  claimOwner,
  claimRef,
  claimTarget,
  cleanNote,
  expiry,
  type LiveClaim,
  MAX_NOTE_LENGTH,
  MAX_PARTICIPANTS,
  newPathClaimTarget,
  ownsClaim,
  participantExpiry,
  requireOnlineGitClaims,
  type TaskClaim,
  validTtl,
  withParticipants,
} from "./model.js";
import { anyPathOverlap, normalizeClaimPaths } from "./paths.js";

const TAKEOVER_GRACE_MS = 5 * 60_000;
const CLOSED_TASK_STATUSES = new Set(["done", "cancelled"]);

export interface TaskClaimInput {
  holder: string;
  session?: string;
  paths?: string[];
  note?: string;
  ttlMinutes?: number;
  offline?: boolean;
  steal?: boolean;
  /** Create a shared (pairing) claim, or join an active shared claim (07 §2.1). */
  share?: boolean;
  /**
   * Internal, for reconciling an unsynced local claim (07 §2.4): keep its local start time and allow
   * creating its own `clm-` ID. The heartbeat is the sync time.
   */
  restoreStarted?: string;
}

function holders(claim: LiveClaim): string[] {
  return claim.participants?.map((p) => p.holder) ?? [claim.holder];
}

/** An active claim by another holder whose paths overlap the acquired claim (07 §2.1). */
export interface ClaimOverlap {
  ref: string;
  holder: string;
  paths: string[];
}

export interface ClaimResult {
  /** `unsynced` marks a claim saved locally with `--local` that is not on `aimem-live` yet. */
  claim: LiveClaim & { unsynced?: true };
  /** The caller's session, which differs from `claim.session` after joining a shared claim. */
  session: string;
  overlaps: ClaimOverlap[];
  warnings: string[];
}

function overlapsWith(claim: LiveClaim, owner: ClaimOwner, others: LiveClaim[], now: number): ClaimOverlap[] {
  if (!claim.paths) return [];
  return others
    .filter(
      (other) =>
        !holders(other).includes(owner.holder) &&
        now < expiry(other) &&
        other.paths !== undefined &&
        anyPathOverlap(claim.paths ?? [], other.paths),
    )
    .map((other) => ({ ref: claimRef(other), holder: other.holder, paths: other.paths ?? [] }));
}

/** Validate claim input locally, before any Git call, and return what a new claim needs. */
export async function prepareClaim(
  nb: Notebook,
  ref: string | undefined,
  input: TaskClaimInput,
  deps: ClaimDeps,
) {
  if (ref === undefined && input.steal) throw new AimemError("USAGE", "Provide the claim to take over.");
  if (ref === undefined && input.paths === undefined) {
    throw new AimemError("USAGE", "Provide a task ref or --paths for a path-only claim.");
  }
  const target = ref === undefined ? newPathClaimTarget(deps.random) : claimTarget(nb, ref);
  const label = target.task ?? target.id;
  if (input.share && target.task === undefined) {
    throw new AimemError("USAGE", "Shared claims require a task ref.");
  }
  const owner = claimOwner(input.holder, input.session ?? Buffer.from(deps.random.bytes(16)).toString("hex"));
  const now = deps.clock.now().toISOString();
  const started = input.restoreStarted ?? now;
  const ttl = input.ttlMinutes ?? nb.config.claims?.ttl_minutes ?? PROJECT_DEFAULTS.claims.ttl_minutes;
  if (!validTtl(ttl, started))
    throw new AimemError("USAGE", "Claim TTL must be positive whole minutes with a valid expiry.");
  let paths = input.paths === undefined ? undefined : normalizeClaimPaths(input.paths);
  const note = input.note === undefined ? undefined : cleanNote(input.note);
  if (note !== undefined && note.length > MAX_NOTE_LENGTH) {
    throw new AimemError("USAGE", `Keep the claim note under ${MAX_NOTE_LENGTH} characters.`);
  }
  const metadata = [owner.holder, owner.session, ...(paths ?? []), note ?? ""].join("\n");
  if (scanSecrets(metadata, await loadSecretIgnore(deps.fs, nb.dir)).length) {
    throw new AimemError("SECRET_DETECTED", "Possible secret in claim metadata. Remove it and retry.");
  }
  const warnings: string[] = [];
  if (target.task !== undefined) {
    const index = await loadIndex(nb, deps);
    const record = index.records.find((r) => r.id === target.id && r.type === "task");
    if (!record) throw new AimemError("NOT_FOUND", "Task ref does not resolve in this notebook.");
    // 3.5 decision 7: a task claim without --paths carries the task's paths, so overlaps are visible.
    if (paths === undefined && record.paths.length > 0) {
      try {
        paths = normalizeClaimPaths(record.paths);
      } catch {
        warnings.push(`${target.task} has paths that are not valid claim paths; claiming without paths.`);
      }
    }
    if (CLOSED_TASK_STATUSES.has(record.status)) {
      warnings.push(`${target.task} is ${record.status} in this checkout.`);
    }
  }

  const build = (claimPaths: string[] | undefined): LiveClaim => {
    const fields = {
      ...owner,
      started,
      heartbeat: now,
      ttl_minutes: ttl,
      ...(claimPaths === undefined ? {} : { paths: claimPaths }),
      ...(note === undefined || note === "" ? {} : { note }),
      ...(input.share
        ? { shared: true as const, participants: [{ ...owner, joined: started, heartbeat: now }] }
        : {}),
    };
    return target.task === undefined
      ? { id: target.id, ...fields, paths: claimPaths ?? [] }
      : ({ task: target.task, ...fields } satisfies TaskClaim);
  };
  return { target, label, owner, started, now, ttl, paths, warnings, build };
}

/**
 * Acquire an exclusive task claim, or a path-only claim when `ref` is omitted.
 * Path overlap with other holders is reported, never blocking. No durable notebook records are written.
 */
export async function acquireClaim(
  nb: Notebook,
  ref: string | undefined,
  input: TaskClaimInput,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  requireOnlineGitClaims(nb, input.offline);
  const {
    target,
    label,
    owner,
    now: joinedAt,
    paths,
    warnings,
    build,
  } = await prepareClaim(nb, ref, input, deps);
  const result = (claim: LiveClaim, others: LiveClaim[]): ClaimResult => {
    const overlaps = overlapsWith(claim, owner, others, deps.clock.now().getTime());
    return {
      claim,
      session: owner.session,
      overlaps,
      warnings: [
        ...warnings,
        ...overlaps.map(
          (overlap) =>
            `Paths overlap ${overlap.ref} held by ${overlap.holder} (${overlap.paths.join(", ")}).`,
        ),
      ],
    };
  };

  return mutateClaim(
    nb,
    target,
    deps,
    Boolean(input.steal),
    (current, others) => {
      if (current === undefined) {
        if (input.steal) throw new AimemError("NOT_FOUND", "There is no live claim to take over.");
        if (ref !== undefined && target.task === undefined && input.restoreStarted === undefined) {
          throw new AimemError("NOT_FOUND", "There is no live path-only claim with that ID.");
        }
        const claim = build(paths);
        return {
          result: result(claim, others),
          change: { claim, message: target.task ? "aimem: claim task" : "aimem: claim paths" },
        };
      }
      const now = deps.clock.now().getTime();
      const expires = expiry(current);
      if (now < expires) {
        if (ownsClaim(current, owner)) return { result: result(current, others) };
        if (current.shared && input.share) {
          const active = (current.participants ?? []).filter((p) => now < participantExpiry(current, p));
          if (active.length >= MAX_PARTICIPANTS) {
            throw claimConflict(current, `${label} already has ${MAX_PARTICIPANTS} participants.`);
          }
          const joined = withParticipants(current, [
            ...active,
            { ...owner, joined: joinedAt, heartbeat: joinedAt },
          ]);
          if (!joined) throw new AimemError("SYNC_FAILED", "Could not join the shared claim.");
          return {
            result: result(joined, others),
            change: { claim: joined, message: "aimem: join shared task claim" },
          };
        }
        if (current.shared) {
          throw claimConflict(
            current,
            `${label} is a shared claim held by ${current.holder}. Use --share to join.`,
          );
        }
        if (input.share) {
          throw claimConflict(
            current,
            `${label} is claimed exclusively by ${current.holder}. Ask them to release it and re-claim with --share, or wait for release.`,
          );
        }
        if (current.holder === owner.holder) {
          throw claimConflict(
            current,
            `You already hold ${label} from another session (${current.session}). Reuse it with --session ${current.session} or AIMEM_SESSION, or release it first.`,
          );
        }
        throw claimConflict(current, `${label} is claimed by ${current.holder}.`);
      }
      if (!input.steal) {
        throw claimConflict(
          current,
          `${label} has an expired claim. Use --steal to take it over when eligible.`,
        );
      }
      if (now < expires + TAKEOVER_GRACE_MS) {
        throw claimConflict(current, `${label} is still within the five-minute clock-skew allowance.`);
      }
      // A path-only takeover keeps the abandoned paths unless new ones are given.
      const claim = build(paths ?? (target.task === undefined ? current.paths : undefined));
      return {
        result: result(claim, others),
        change: {
          claim,
          message: `aimem: take over task claim\n\n${[...new Set(holders(current))]
            .map((holder) => `Aimem-Previous-Holder: ${holder}`)
            .join("\n")}`,
        },
      };
    },
    { readOthers: true },
  );
}

/** Acquire an exclusive task claim and return only the claim (M3.2 contract). */
export async function acquireTaskClaim(
  nb: Notebook,
  ref: string,
  input: TaskClaimInput,
  deps: ClaimDeps,
): Promise<TaskClaim> {
  return (await acquireClaim(nb, ref, input, deps)).claim as TaskClaim;
}
