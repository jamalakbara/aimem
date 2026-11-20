import { baseFrontmatterSchema, ID_ALPHABET, parseRef, REF_RE, typeFromId } from "@aimem/schema";
import { AimemError } from "../errors.js";
import type { Git } from "../git/git.js";
import type { Clock, Fs, Random } from "../ports.js";
import type { Notebook } from "../project/load.js";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export type ClaimDeps = { fs: Fs; clock: Clock; random: Random; git: Git };
export type ClaimOwner = { holder: string; session: string };
/** A task claim has `task`; a path-only claim (07 §2.1) has a `clm-` ID instead. */
export type ClaimTarget = { id: string; task?: string; path: string };

/** Path-only claim IDs live only on `aimem-live`; they are not notebook record IDs. */
export const CLAIM_ID_RE = /^clm-[0-9a-hjkmnp-tv-z]{8}$/;

interface ClaimFields extends ClaimOwner {
  on_behalf_of?: string;
  paths?: string[];
  note?: string;
  started: string;
  heartbeat: string;
  ttl_minutes: number;
}

export interface TaskClaim extends ClaimFields {
  task: string;
}

export interface PathClaim extends ClaimFields {
  id: string;
  paths: string[];
}

export type LiveClaim = TaskClaim | PathClaim;

export function claimRef(claim: LiveClaim): string {
  return "task" in claim ? claim.task : claim.id;
}

export function requireOnlineGitClaims(nb: Notebook, offline?: boolean): void {
  if (offline || nb.config.mode !== "team" || nb.config.sync !== "git") {
    throw new AimemError("USAGE", "Task claims require an online team notebook with Git sync.");
  }
}

export function newPathClaimTarget(random: Random): ClaimTarget {
  const bytes = random.bytes(8);
  let id = "clm-";
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[(bytes[i] ?? 0) % 32];
  return { id, path: `claims/${id}.json` };
}

export function claimTarget(nb: Notebook, ref: string): ClaimTarget {
  if (CLAIM_ID_RE.test(ref)) return { id: ref, path: `claims/${ref}.json` };
  const { id, project } = parseRef(ref);
  if (!REF_RE.test(ref) || typeFromId(id) !== "task") {
    throw new AimemError("USAGE", "Provide a valid task ref.");
  }
  if (project !== undefined && project !== nb.config.project) {
    throw new AimemError("NOT_FOUND", "Task ref does not resolve in this notebook.");
  }
  return { id, task: `${nb.config.project}:${id}`, path: `claims/${id}.json` };
}

function validAuthor(author: unknown): author is string {
  return (
    typeof author === "string" &&
    !/\p{Cc}/u.test(author) &&
    baseFrontmatterSchema.shape.author.safeParse(author).success
  );
}

function validTime(time: unknown): time is string {
  return typeof time === "string" && UTC_TIME.test(time) && Number.isFinite(Date.parse(time));
}

export function validTtl(ttl: unknown, time: string): ttl is number {
  return (
    typeof ttl === "number" &&
    Number.isSafeInteger(ttl) &&
    ttl > 0 &&
    Number.isFinite(new Date(Date.parse(time) + ttl * 60_000).getTime())
  );
}

export function validPaths(paths: unknown): paths is string[] {
  return Array.isArray(paths) && paths.every((path) => typeof path === "string" && path.trim());
}

export function claimOwner(holder: string, session?: string): ClaimOwner {
  if (!validAuthor(holder)) throw new AimemError("USAGE", "Invalid claim author.");
  if (session === undefined || !SESSION_ID.test(session)) {
    throw new AimemError(
      "USAGE",
      "Provide a session ID of 1–64 letters, digits, underscores or hyphens, starting with a letter or digit.",
    );
  }
  return { holder, session };
}

export function ownsClaim(claim: LiveClaim, owner: ClaimOwner): boolean {
  return claim.holder === owner.holder && claim.session === owner.session;
}

export function expiry(claim: LiveClaim): number {
  return Date.parse(claim.heartbeat) + claim.ttl_minutes * 60_000;
}

export function claimConflict(claim: LiveClaim, message: string): AimemError {
  return new AimemError("CLAIM_CONFLICT", message, { holder: claim.holder, since: claim.started });
}

export function readClaim(text: string, target: Pick<ClaimTarget, "id" | "task">): LiveClaim {
  let claim: (Partial<TaskClaim> & Partial<PathClaim>) | undefined;
  try {
    claim = JSON.parse(text);
  } catch {
    // Handle invalid JSON the same way as invalid claim fields.
  }
  const identity =
    target.task === undefined
      ? claim?.id === target.id &&
        claim.task === undefined &&
        validPaths(claim.paths) &&
        claim.paths.length > 0
      : claim?.task === target.task && claim.id === undefined;
  if (
    !claim ||
    !identity ||
    !validAuthor(claim.holder) ||
    typeof claim.session !== "string" ||
    !SESSION_ID.test(claim.session) ||
    !validTime(claim.started) ||
    !validTime(claim.heartbeat) ||
    Date.parse(claim.started) > Date.parse(claim.heartbeat) ||
    !validTtl(claim.ttl_minutes, claim.heartbeat) ||
    (claim.on_behalf_of !== undefined && !validAuthor(claim.on_behalf_of)) ||
    (claim.paths !== undefined && !validPaths(claim.paths)) ||
    (claim.note !== undefined && typeof claim.note !== "string")
  ) {
    throw new AimemError("SYNC_FAILED", "The existing Git claim has invalid content.");
  }
  const { holder, session, started, heartbeat, ttl_minutes, on_behalf_of, paths, note } = claim;
  const fields = {
    holder,
    session,
    started,
    heartbeat,
    ttl_minutes,
    ...(on_behalf_of === undefined ? {} : { on_behalf_of }),
    ...(paths === undefined ? {} : { paths }),
    ...(note === undefined ? {} : { note }),
  };
  return target.task === undefined
    ? { id: target.id, ...fields, paths: paths as string[] }
    : { task: target.task, ...fields };
}
