import { join } from "node:path";
import { typeFromId } from "@aimem/schema";
import { AimemError } from "../errors.js";
import { openLiveBranch } from "../git/live.js";
import type { Notebook } from "../project/load.js";
import {
  CLAIM_ID_RE,
  type ClaimDeps,
  type ClaimTarget,
  claimConflict,
  claimOwner,
  claimRef,
  claimTarget,
  expiry,
  type LiveClaim,
  ownsClaim,
  readClaim,
  requireOnlineGitClaims,
  validTtl,
} from "./model.js";

const PUSH_ATTEMPTS = 3;

type ClaimEdit<T> = { result: T; change?: { claim: LiveClaim | null; message: string } };

type LiveBranch = Awaited<ReturnType<typeof openLiveBranch>>;

/** Parse every claim at a tip. Malformed entries are skipped and reported by path. */
async function readAllClaims(
  live: LiveBranch,
  tip: string,
  project: string,
): Promise<{ claims: LiveClaim[]; invalid: string[] }> {
  const claims: LiveClaim[] = [];
  const invalid: string[] = [];
  for (const path of await live.listPaths(tip)) {
    const id = /^claims\/([^/]+)\.json$/.exec(path)?.[1];
    const target =
      id === undefined
        ? undefined
        : CLAIM_ID_RE.test(id)
          ? { id }
          : typeFromId(id) === "task"
            ? { id, task: `${project}:${id}` }
            : undefined;
    const file = target && (await live.readFile(tip, path).catch(() => undefined));
    try {
      if (target === undefined || file === undefined) throw new Error("invalid");
      claims.push(readClaim(file, target));
    } catch {
      invalid.push(path);
    }
  }
  return { claims, invalid };
}

/** Apply a claim change with the exact-tip lease, preserving a guarded operation's original target. */
export async function mutateClaim<T>(
  nb: Notebook,
  target: ClaimTarget,
  deps: ClaimDeps,
  guardTarget: boolean,
  decide: (current: LiveClaim | undefined, others: LiveClaim[]) => ClaimEdit<T>,
  options: { readOthers?: boolean } = {},
): Promise<T> {
  const live = await openLiveBranch(nb.root, join(nb.dir, ".cache"), deps);
  let original: { claim: LiveClaim; revision: string } | undefined;
  let pending: { tip: string; commit: string; result: T; removed: boolean } | undefined;
  try {
    for (let attempt = 0; attempt <= PUSH_ATTEMPTS; attempt++) {
      const tip = await live.fetch();
      if (guardTarget && pending && (await live.contains(tip, pending.commit))) return pending.result;
      const file = await live.readFile(tip, target.path);
      const current = file === undefined ? undefined : readClaim(file, target);
      if (pending?.removed && current === undefined) return pending.result;
      if (original && (await live.lastChange(tip, target.path)) !== original.revision) {
        throw claimConflict(
          current ?? original.claim,
          `${target.task} changed during the request. Check aimem live before retrying.`,
        );
      }
      const others = options.readOthers
        ? (await readAllClaims(live, tip, nb.config.project)).claims.filter(
            (claim) => claimRef(claim) !== (target.task ?? target.id),
          )
        : [];
      const edit = decide(current, others);
      if (!edit.change) return edit.result;
      if (attempt === PUSH_ATTEMPTS || tip === pending?.tip) break;
      if (guardTarget && current && !original) {
        original = { claim: current, revision: await live.lastChange(tip, target.path) };
      }
      const removed = edit.change.claim === null;
      const data = removed ? null : `${JSON.stringify(edit.change.claim, null, 2)}\n`;
      const push = await live.publish(tip, target.path, data, edit.change.message);
      if (push.accepted) return edit.result;
      pending = { tip, commit: push.commit, result: edit.result, removed };
    }
    throw new AimemError(
      "SYNC_FAILED",
      "Could not publish the claim update. Check Git push access and retry with the same session ID.",
    );
  } finally {
    await live.close();
  }
}

interface LifecycleInput {
  holder: string;
  session?: string;
  offline?: boolean;
}

export async function heartbeatTaskClaim(
  nb: Notebook,
  ref: string,
  input: LifecycleInput,
  deps: ClaimDeps,
): Promise<LiveClaim> {
  requireOnlineGitClaims(nb, input.offline);
  const target = claimTarget(nb, ref);
  const label = target.task ?? target.id;
  const owner = claimOwner(input.holder, input.session);
  return mutateClaim(nb, target, deps, true, (current) => {
    if (current === undefined) throw new AimemError("NOT_FOUND", "There is no live claim to heartbeat.");
    if (!ownsClaim(current, owner)) throw claimConflict(current, `${label} is claimed by another session.`);
    const now = deps.clock.now();
    if (now.getTime() >= expiry(current))
      throw claimConflict(current, `${label} has expired. Use --steal when eligible.`);
    if (now.getTime() <= Date.parse(current.heartbeat)) return { result: current };
    const heartbeat = now.toISOString();
    if (!validTtl(current.ttl_minutes, heartbeat))
      throw new AimemError("USAGE", "Claim heartbeat would produce an invalid expiry.");
    const claim = { ...current, heartbeat };
    return { result: claim, change: { claim, message: "aimem: heartbeat task claim" } };
  });
}

export async function releaseTaskClaim(
  nb: Notebook,
  ref: string,
  input: LifecycleInput,
  deps: ClaimDeps,
): Promise<boolean> {
  requireOnlineGitClaims(nb, input.offline);
  const target = claimTarget(nb, ref);
  const owner = claimOwner(input.holder, input.session);
  return mutateClaim<boolean>(nb, target, deps, true, (current) => {
    if (current === undefined) return { result: false };
    if (!ownsClaim(current, owner))
      throw claimConflict(current, `${target.task ?? target.id} is claimed by another session.`);
    return { result: true, change: { claim: null, message: "aimem: release task claim" } };
  });
}

export type LiveClaimView = LiveClaim & { expired: boolean; expiresAt: string };

/** Fetch once and list task claims by task ref, then path-only claims by ID. Malformed entries become warnings. */
export async function readLiveClaims(
  nb: Notebook,
  offline: boolean,
  deps: ClaimDeps,
): Promise<{ claims: LiveClaimView[]; warnings: string[] }> {
  requireOnlineGitClaims(nb, offline);
  const live = await openLiveBranch(nb.root, join(nb.dir, ".cache"), deps);
  try {
    const tip = await live.fetch();
    const now = deps.clock.now().getTime();
    const { claims, invalid } = await readAllClaims(live, tip, nb.config.project);
    const order = (claim: LiveClaim) => `${"task" in claim ? 0 : 1}${claimRef(claim)}`;
    return {
      claims: claims
        .sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0))
        .map((claim) => {
          const expires = expiry(claim);
          return { ...claim, expired: now >= expires, expiresAt: new Date(expires).toISOString() };
        }),
      warnings: invalid.sort().map((path) => `Skipped invalid live claim entry ${path}.`),
    };
  } finally {
    await live.close();
  }
}

export async function listLiveClaims(
  nb: Notebook,
  offline: boolean,
  deps: ClaimDeps,
): Promise<LiveClaimView[]> {
  return (await readLiveClaims(nb, offline, deps)).claims;
}
