import { join } from "node:path";
import { typeFromId } from "@aimem/schema";
import { AimemError } from "../errors.js";
import type { Notebook } from "../project/load.js";
import { writeFileAtomic } from "../records/store.js";
import { acquireClaim, type ClaimResult, prepareClaim, type TaskClaimInput } from "./acquire.js";
import {
  CLAIM_ID_RE,
  type ClaimDeps,
  type ClaimTarget,
  claimConflict,
  expiry,
  type LiveClaim,
  ownsClaim,
  readClaim,
} from "./model.js";

/** An intended claim saved while `aimem-live` was unreachable (07 §2.4). */
export type UnsyncedClaim = LiveClaim & { unsynced: true };

function pendingDir(nb: Notebook): string {
  return join(nb.dir, ".cache", "claims-pending");
}

function requireGitTeam(nb: Notebook): void {
  if (nb.config.mode !== "team" || nb.config.sync !== "git") {
    throw new AimemError("USAGE", "Task claims require a team notebook with Git sync.");
  }
}

function fileTarget(nb: Notebook, file: string): Pick<ClaimTarget, "id" | "task"> | undefined {
  const id = /^([^/\\]+)\.json$/.exec(file)?.[1];
  if (id === undefined) return undefined;
  if (CLAIM_ID_RE.test(id)) return { id };
  return typeFromId(id) === "task" ? { id, task: `${nb.config.project}:${id}` } : undefined;
}

/** Read saved local claims. Unreadable files are reported by name and left in place. */
export async function listUnsyncedClaims(
  nb: Notebook,
  deps: Pick<ClaimDeps, "fs">,
): Promise<{ claims: UnsyncedClaim[]; invalid: string[] }> {
  requireGitTeam(nb);
  const files = await deps.fs.readdir(pendingDir(nb)).catch(() => [] as string[]);
  const claims: UnsyncedClaim[] = [];
  const invalid: string[] = [];
  for (const file of files.filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort()) {
    const target = fileTarget(nb, file);
    try {
      if (!target) throw new Error("invalid");
      claims.push({
        ...readClaim(await deps.fs.readFile(join(pendingDir(nb), file)), target),
        unsynced: true,
      });
    } catch {
      invalid.push(file);
    }
  }
  return { claims, invalid };
}

/**
 * Save an unsynced local claim (`--local`). It never displaces a live claim: the next online claim
 * command or `aimem live` publishes it through the normal compare-and-swap.
 */
export async function saveLocalClaim(
  nb: Notebook,
  ref: string | undefined,
  input: TaskClaimInput,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  requireGitTeam(nb);
  if (input.steal || input.share) {
    throw new AimemError("USAGE", "--local cannot be combined with --steal or --share.");
  }
  const { target, label, owner, paths, warnings, build } = await prepareClaim(nb, ref, input, deps);
  if (ref !== undefined && target.task === undefined) {
    throw new AimemError("USAGE", "--local cannot extend an existing path-only claim.");
  }
  const path = join(pendingDir(nb), `${target.id}.json`);
  const existing = await deps.fs.readFile(path).then(
    (text) => readClaim(text, target),
    () => undefined,
  );
  if (existing && deps.clock.now().getTime() < expiry(existing)) {
    if (!ownsClaim(existing, owner)) {
      throw claimConflict(existing, `${label} already has an unsynced local claim by ${existing.holder}.`);
    }
    return { claim: { ...existing, unsynced: true }, session: owner.session, overlaps: [], warnings };
  }
  const claim = build(paths);
  await writeFileAtomic(deps.fs, path, `${JSON.stringify(claim, null, 2)}\n`, deps.random);
  return {
    claim: { ...claim, unsynced: true },
    session: owner.session,
    overlaps: [],
    warnings: [
      ...warnings,
      `Saved an unsynced local claim for ${label}. It syncs on the next online claim command or aimem live.`,
    ],
  };
}

/**
 * Publish saved local claims before an online claim command. A claim that lost to an earlier live
 * claim, expired, or no longer resolves is dropped with a warning. A sync failure keeps the rest.
 */
export async function reconcileLocalClaims(nb: Notebook, deps: ClaimDeps): Promise<string[]> {
  if (nb.config.mode !== "team" || nb.config.sync !== "git") return [];
  const { claims, invalid } = await listUnsyncedClaims(nb, deps);
  const warnings = invalid.map((file) => `Skipped unreadable unsynced claim file ${file}.`);
  for (const claim of claims) {
    const ref = "task" in claim ? claim.task : claim.id;
    const file = join(pendingDir(nb), `${"task" in claim ? ref.slice(ref.indexOf(":") + 1) : ref}.json`);
    const drop = async (reason: string) => {
      await deps.fs.unlink(file).catch(() => undefined);
      warnings.push(`Dropped the unsynced claim for ${ref}: ${reason}`);
    };
    if (deps.clock.now().getTime() >= Date.parse(claim.started) + claim.ttl_minutes * 60_000) {
      await drop("it expired before it could sync.");
      continue;
    }
    try {
      await acquireClaim(
        nb,
        ref,
        {
          holder: claim.holder,
          session: claim.session,
          ttlMinutes: claim.ttl_minutes,
          restoreStarted: claim.started,
          ...(claim.paths === undefined ? {} : { paths: claim.paths }),
          ...(claim.note === undefined ? {} : { note: claim.note }),
        },
        deps,
      );
      await deps.fs.unlink(file).catch(() => undefined);
      warnings.push(`Synced the unsynced claim for ${ref}.`);
    } catch (error) {
      if (!(error instanceof AimemError)) throw error;
      if (error.code === "SYNC_FAILED") break;
      const holder = typeof error.details?.holder === "string" ? ` held by ${error.details.holder}` : "";
      const since = typeof error.details?.since === "string" ? ` since ${error.details.since}` : "";
      await drop(error.code === "CLAIM_CONFLICT" ? `the live claim is${holder}${since}.` : error.message);
    }
  }
  return warnings;
}
