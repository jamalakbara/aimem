import { join } from "node:path";
import { typeFromId } from "@aimem/schema";
import { AimemError } from "../errors.js";
import { openLiveBranch } from "../git/live.js";
import type { Notebook } from "../project/load.js";
import {
  type ClaimDeps,
  type ClaimTarget,
  claimConflict,
  claimOwner,
  claimTarget,
  expiry,
  ownsClaim,
  readClaim,
  requireOnlineGitClaims,
  type TaskClaim,
  validTtl,
} from "./model.js";

const PUSH_ATTEMPTS = 3;

type ClaimEdit<T> = { result: T; change?: { claim: TaskClaim | null; message: string } };

/** Apply a claim change with the exact-tip lease, preserving a guarded operation's original target. */
export async function mutateClaim<T>(
  nb: Notebook,
  target: ClaimTarget,
  deps: ClaimDeps,
  guardTarget: boolean,
  decide: (current: TaskClaim | undefined) => ClaimEdit<T>,
): Promise<T> {
  const live = await openLiveBranch(nb.root, join(nb.dir, ".cache"), deps);
  let original: { claim: TaskClaim; revision: string } | undefined;
  let pending: { tip: string; commit: string; result: T; removed: boolean } | undefined;
  try {
    for (let attempt = 0; attempt <= PUSH_ATTEMPTS; attempt++) {
      const tip = await live.fetch();
      if (guardTarget && pending && (await live.contains(tip, pending.commit))) return pending.result;
      const file = await live.readFile(tip, target.path);
      const current = file === undefined ? undefined : readClaim(file, target.task);
      if (pending?.removed && current === undefined) return pending.result;
      if (original && (await live.lastChange(tip, target.path)) !== original.revision) {
        throw claimConflict(
          current ?? original.claim,
          `${target.task} changed during the request. Check aimem live before retrying.`,
        );
      }
      const edit = decide(current);
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
): Promise<TaskClaim> {
  requireOnlineGitClaims(nb, input.offline);
  const target = claimTarget(nb, ref);
  const owner = claimOwner(input.holder, input.session);
  return mutateClaim(nb, target, deps, true, (current) => {
    if (current === undefined) throw new AimemError("NOT_FOUND", "There is no live claim to heartbeat.");
    if (!ownsClaim(current, owner))
      throw claimConflict(current, `${target.task} is claimed by another session.`);
    const now = deps.clock.now();
    if (now.getTime() >= expiry(current))
      throw claimConflict(current, `${target.task} has expired. Use --steal when eligible.`);
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
      throw claimConflict(current, `${target.task} is claimed by another session.`);
    return { result: true, change: { claim: null, message: "aimem: release task claim" } };
  });
}

export async function listLiveClaims(
  nb: Notebook,
  offline: boolean,
  deps: ClaimDeps,
): Promise<Array<TaskClaim & { expired: boolean; expiresAt: string }>> {
  requireOnlineGitClaims(nb, offline);
  const live = await openLiveBranch(nb.root, join(nb.dir, ".cache"), deps);
  try {
    const tip = await live.fetch();
    const now = deps.clock.now().getTime();
    const claims = [];
    for (const path of (await live.listPaths(tip)).sort()) {
      const id = /^claims\/([^/]+)\.json$/.exec(path)?.[1];
      if (!id || typeFromId(id) !== "task")
        throw new AimemError("SYNC_FAILED", "The Git live branch contains an invalid claim path.");
      const file = await live.readFile(tip, path);
      if (file === undefined)
        throw new AimemError("SYNC_FAILED", "Could not read a claim from the fetched live branch.");
      const claim = readClaim(file, `${nb.config.project}:${id}`);
      const expires = expiry(claim);
      claims.push({ ...claim, expired: now >= expires, expiresAt: new Date(expires).toISOString() });
    }
    return claims;
  } finally {
    await live.close();
  }
}
