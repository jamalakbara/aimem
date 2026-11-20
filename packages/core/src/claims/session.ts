import { AimemError } from "../errors.js";
import type { Notebook } from "../project/load.js";
import { heartbeatTaskClaim, type LiveClaimView, readLiveClaims, releaseTaskClaim } from "./lifecycle.js";
import {
  type ClaimDeps,
  type ClaimOwner,
  claimRef,
  type LiveClaim,
  ownsClaim,
  participantExpiry,
  participantOf,
} from "./model.js";
import { anyPathOverlap } from "./paths.js";
import { discardLocalClaims, listUnsyncedClaims } from "./pending.js";

/**
 * Live state for a briefing or status (06 §2.2 step 7). `unavailable` is a connection or remote
 * failure, which callers must show differently from an empty result.
 */
export type LiveStatus = "on" | "off" | "skipped" | "unavailable";

export type LiveClaimEntry = LiveClaimView & { unsynced?: true };

export interface LiveState {
  status: LiveStatus;
  reason?: string;
  /** Live claims, then unsynced local claims; expired claims are included and marked. */
  claims: LiveClaimEntry[];
}

function localView(claim: LiveClaim & { unsynced: true }, now: number): LiveClaimEntry {
  const expires = Date.parse(claim.heartbeat) + claim.ttl_minutes * 60_000;
  return { ...claim, expired: now >= expires, expiresAt: new Date(expires).toISOString() };
}

/** Read live and unsynced claims without failing: Git problems become `unavailable`. */
export async function readLiveState(
  nb: Notebook,
  deps: ClaimDeps,
  options: { skip?: boolean } = {},
): Promise<LiveState> {
  if (nb.config.mode !== "team" || nb.config.sync !== "git") {
    return { status: "off", reason: "no team Git sync", claims: [] };
  }
  const now = deps.clock.now().getTime();
  const local = (await listUnsyncedClaims(nb, deps)).claims.map((claim) => localView(claim, now));
  if (options.skip) return { status: "skipped", reason: "--no-live", claims: local };
  try {
    const { claims } = await readLiveClaims(nb, false, deps);
    return { status: "on", claims: [...claims, ...local] };
  } catch (error) {
    if (!(error instanceof AimemError) || error.code !== "SYNC_FAILED") throw error;
    return { status: "unavailable", reason: error.message, claims: local };
  }
}

/** Every holder of a claim, in order. */
export function claimHolders(claim: LiveClaim): string[] {
  return claim.participants?.map((p) => p.holder) ?? [claim.holder];
}

/** Minimum age of this session's own heartbeat before a briefing extends it (07 §2.1). */
export const AUTO_HEARTBEAT_MINUTES = 20;

/**
 * Extend this session's active live claims whose own heartbeat is at least 20 minutes old.
 * Expired claims are never revived. Failures become warnings.
 */
export async function heartbeatSessionClaims(
  nb: Notebook,
  state: LiveState,
  owner: Partial<ClaimOwner> & { holder: string },
  deps: ClaimDeps,
): Promise<{ extended: string[]; warnings: string[] }> {
  const extended: string[] = [];
  const warnings: string[] = [];
  if (state.status !== "on" || owner.session === undefined) return { extended, warnings };
  const me = { holder: owner.holder, session: owner.session };
  const now = deps.clock.now().getTime();
  for (const claim of state.claims) {
    if (claim.unsynced || claim.expired || !ownsClaim(claim, me)) continue;
    const mine = participantOf(claim, me);
    if (mine && now >= participantExpiry(claim, mine)) continue;
    const last = Date.parse(mine?.heartbeat ?? claim.heartbeat);
    // A claim with a TTL of 20 minutes or less would expire before the 20-minute mark: renew at half its TTL.
    const due = Math.min(AUTO_HEARTBEAT_MINUTES, claim.ttl_minutes / 2) * 60_000;
    if (now - last < due) continue;
    const ref = claimRef(claim);
    try {
      await heartbeatTaskClaim(nb, ref, me, deps);
      extended.push(ref);
    } catch (error) {
      if (!(error instanceof AimemError)) throw error;
      warnings.push(`Could not extend the claim for ${ref}: ${error.message}`);
    }
  }
  return { extended, warnings };
}

/** Summary for `aimem status` (04 §3): counts and the caller's own claims. */
export function summarizeLiveState(state: LiveState, holder?: string) {
  if (state.status !== "on" && state.status !== "skipped" && state.status !== "unavailable") return null;
  const active = state.claims.filter((c) => !c.expired && !c.unsynced);
  return {
    status: state.status,
    ...(state.reason ? { reason: state.reason } : {}),
    active: active.length,
    expired: state.claims.filter((c) => c.expired && !c.unsynced).length,
    unsynced: state.claims.filter((c) => c.unsynced).length,
    mine:
      holder === undefined
        ? []
        : state.claims
            .filter((c) => claimHolders(c).includes(holder))
            .map((c) => ({
              ref: claimRef(c),
              expiresAt: c.expiresAt,
              ...(c.expired ? { expired: true } : {}),
              ...(c.unsynced ? { unsynced: true } : {}),
              ...(c.shared ? { shared: true } : {}),
            })),
  };
}

/** What `handoff` did with live claims (04 §4, 3.5 decision 4). */
export interface HandoffClaims {
  status: LiveStatus;
  /** When live state was read, so the receiver knows when to recheck `aimem live`. */
  checkedAt: string;
  /** Claims released (or left, for shared claims) and unsynced local claims discarded. */
  released: string[];
  /** The caller's claims that are still held, with the reason. */
  kept: { ref: string; reason: string }[];
  /** Active claims by other holders on the handed-off task or overlapping its paths. */
  related: { ref: string; holders: string[]; paths?: string[] }[];
}

/**
 * Release this session's claims after a handoff record is written. Never throws for Git or
 * ownership problems: they become `kept` entries and warnings, so the handoff itself stands.
 */
export async function releaseSessionClaims(
  nb: Notebook,
  owner: Partial<ClaimOwner> & { holder: string },
  deps: ClaimDeps,
  options: { release?: boolean; task?: { ref: string; paths: string[] } } = {},
): Promise<{ claims: HandoffClaims; warnings: string[] }> {
  const checkedAt = deps.clock.now().toISOString();
  const state = await readLiveState(nb, deps);
  const claims: HandoffClaims = { status: state.status, checkedAt, released: [], kept: [], related: [] };
  const warnings: string[] = [];
  if (state.status === "off") return { claims, warnings };
  if (state.status === "unavailable") {
    warnings.push(
      `Team claims could not be checked (${state.reason ?? "remote unavailable"}); your claims may still be active. Retry aimem task release <ref> with the same session.`,
    );
  }
  const session = owner.session;
  for (const claim of state.claims) {
    const ref = claimRef(claim);
    const holders = claimHolders(claim);
    const mine = session !== undefined && ownsClaim(claim, { holder: owner.holder, session });
    if (!holders.includes(owner.holder)) {
      const task = options.task;
      const relatedToTask =
        task !== undefined &&
        (ref.endsWith(`:${task.ref}`) ||
          (claim.paths !== undefined && task.paths.length > 0 && anyPathOverlap(task.paths, claim.paths)));
      if (relatedToTask && !claim.expired && !claim.unsynced) {
        claims.related.push({ ref, holders, ...(claim.paths ? { paths: claim.paths } : {}) });
      }
      continue;
    }
    if (options.release === false) {
      claims.kept.push({ ref, reason: "kept with --no-release-claims" });
      continue;
    }
    if (!mine) {
      const other = claim.participants?.find((p) => p.holder === owner.holder)?.session ?? claim.session;
      claims.kept.push({
        ref,
        reason:
          session === undefined ? `no session given (held by session ${other})` : `held by session ${other}`,
      });
      continue;
    }
    if (claim.unsynced) continue;
    try {
      if (await releaseTaskClaim(nb, ref, { holder: owner.holder, session }, deps)) claims.released.push(ref);
    } catch (error) {
      if (!(error instanceof AimemError)) throw error;
      claims.kept.push({ ref, reason: error.message });
    }
  }
  if (session !== undefined && options.release !== false) {
    claims.released.push(...(await discardLocalClaims(nb, { holder: owner.holder, session }, deps)));
  }
  for (const k of claims.kept) {
    if (k.reason === "kept with --no-release-claims") continue;
    warnings.push(
      `The claim on ${k.ref} is still active (${k.reason}). Release it with aimem task release ${k.ref} --session <id>.`,
    );
  }
  return { claims, warnings };
}

/**
 * `aimem live` and MCP `aimem_live`: live claims (unless offline) followed by unsynced local claims.
 * Unlike `readLiveState`, a Git failure is an error here.
 */
export async function listClaimsWithLocal(
  nb: Notebook,
  offline: boolean,
  deps: ClaimDeps,
): Promise<{ claims: LiveClaimEntry[]; warnings: string[] }> {
  if (nb.config.mode !== "team" || nb.config.sync !== "git") {
    throw new AimemError("USAGE", "Task claims require a team notebook with Git sync.");
  }
  const remote = offline ? { claims: [], warnings: [] } : await readLiveClaims(nb, false, deps);
  const local = await listUnsyncedClaims(nb, deps);
  const now = deps.clock.now().getTime();
  return {
    claims: [...remote.claims, ...local.claims.map((claim) => localView(claim, now))],
    warnings: [
      ...remote.warnings,
      ...local.invalid.map((file) => `Skipped unreadable unsynced claim file ${file}.`),
    ],
  };
}
