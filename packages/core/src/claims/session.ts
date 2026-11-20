import { AimemError } from "../errors.js";
import type { Notebook } from "../project/load.js";
import { heartbeatTaskClaim, type LiveClaimView, readLiveClaims } from "./lifecycle.js";
import {
  type ClaimDeps,
  type ClaimOwner,
  claimRef,
  type LiveClaim,
  ownsClaim,
  participantExpiry,
  participantOf,
} from "./model.js";
import { listUnsyncedClaims } from "./pending.js";

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
    if (now - last < AUTO_HEARTBEAT_MINUTES * 60_000) continue;
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
