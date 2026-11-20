import { join } from "node:path";
import { baseFrontmatterSchema, PROJECT_DEFAULTS, parseRef, REF_RE, typeFromId } from "@aimem/schema";
import { AimemError } from "../errors.js";
import type { Git } from "../git/git.js";
import { openLiveBranch } from "../git/live.js";
import { loadIndex } from "../index/build.js";
import type { Clock, Fs, Random } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { loadSecretIgnore, scanSecrets } from "../secrets/scan.js";
import { toPosix } from "../util/path.js";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const PUSH_ATTEMPTS = 3;

export interface TaskClaimInput {
  holder: string;
  session?: string;
  paths?: string[];
  note?: string;
  ttlMinutes?: number;
  offline?: boolean;
}

export interface TaskClaim {
  task: string;
  holder: string;
  on_behalf_of?: string;
  session: string;
  paths?: string[];
  note?: string;
  started: string;
  heartbeat: string;
  ttl_minutes: number;
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

function validTtl(ttl: unknown, time: string): ttl is number {
  return (
    typeof ttl === "number" &&
    Number.isSafeInteger(ttl) &&
    ttl > 0 &&
    Number.isFinite(new Date(Date.parse(time) + ttl * 60_000).getTime())
  );
}

function validPaths(paths: unknown): paths is string[] {
  return Array.isArray(paths) && paths.every((path) => typeof path === "string" && path.trim());
}

function readClaim(text: string, task: string): TaskClaim {
  let claim: Partial<TaskClaim> | undefined;
  try {
    claim = JSON.parse(text);
  } catch {
    // Handle invalid JSON the same way as invalid claim fields.
  }
  if (
    claim?.task !== task ||
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
  return {
    task,
    holder,
    session,
    started,
    heartbeat,
    ttl_minutes,
    ...(on_behalf_of === undefined ? {} : { on_behalf_of }),
    ...(paths === undefined ? {} : { paths }),
    ...(note === undefined ? {} : { note }),
  };
}

/** Acquire an exclusive claim without writing any durable notebook records. */
export async function acquireTaskClaim(
  nb: Notebook,
  ref: string,
  input: TaskClaimInput,
  deps: { fs: Fs; clock: Clock; random: Random; git: Git },
): Promise<TaskClaim> {
  if (input.offline || nb.config.mode !== "team" || nb.config.sync !== "git") {
    throw new AimemError("USAGE", "Task claims require an online team notebook with Git sync.");
  }
  const { id, project } = parseRef(ref);
  if (!REF_RE.test(ref) || typeFromId(id) !== "task")
    throw new AimemError("USAGE", "Provide a valid task ref.");
  if (project !== undefined && project !== nb.config.project) {
    throw new AimemError("NOT_FOUND", "Task ref does not resolve in this notebook.");
  }
  const session = input.session ?? Buffer.from(deps.random.bytes(16)).toString("hex");
  if (!SESSION_ID.test(session)) {
    throw new AimemError(
      "USAGE",
      "Session must contain 1–64 letters, digits, underscores or hyphens and start with a letter or digit.",
    );
  }
  const started = deps.clock.now().toISOString();
  const ttl = input.ttlMinutes ?? nb.config.claims?.ttl_minutes ?? PROJECT_DEFAULTS.claims.ttl_minutes;
  if (!validTtl(ttl, started))
    throw new AimemError("USAGE", "Claim TTL must be positive whole minutes with a valid expiry.");
  if (!validAuthor(input.holder)) throw new AimemError("USAGE", "Invalid claim author.");
  if (input.paths !== undefined && (!validPaths(input.paths) || input.paths.length === 0))
    throw new AimemError("USAGE", "Provide one or more claim paths.");
  const paths = input.paths?.map(toPosix);
  const metadata = [input.holder, session, ...(paths ?? []), input.note ?? ""].join("\n");
  if (scanSecrets(metadata, await loadSecretIgnore(deps.fs, nb.dir)).length) {
    throw new AimemError("SECRET_DETECTED", "Possible secret in claim metadata. Remove it and retry.");
  }
  const index = await loadIndex(nb, deps);
  if (!index.records.some((record) => record.id === id && record.type === "task")) {
    throw new AimemError("NOT_FOUND", "Task ref does not resolve in this notebook.");
  }

  const task = `${nb.config.project}:${id}`;
  const claim: TaskClaim = {
    task,
    holder: input.holder,
    session,
    started,
    heartbeat: started,
    ttl_minutes: ttl,
    ...(paths === undefined ? {} : { paths }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
  const path = `claims/${id}.json`;
  const live = await openLiveBranch(nb.root, join(nb.dir, ".cache"), deps);
  let previousTip: string | undefined;
  try {
    for (let attempt = 0; attempt <= PUSH_ATTEMPTS; attempt++) {
      const tip = await live.fetch();
      const existing = await live.readFile(tip, path);
      if (existing !== undefined) {
        const owner = readClaim(existing, task);
        if (owner.holder === claim.holder && owner.session === claim.session) return owner;
        throw new AimemError("CLAIM_CONFLICT", `${task} is claimed by ${owner.holder}.`, {
          holder: owner.holder,
          since: owner.started,
        });
      }
      if (attempt === PUSH_ATTEMPTS || tip === previousTip) break;
      if (await live.publish(tip, path, `${JSON.stringify(claim, null, 2)}\n`)) return claim;
      previousTip = tip;
    }
    throw new AimemError(
      "SYNC_FAILED",
      "Could not publish the claim. Check Git push access and retry with the same session ID.",
    );
  } finally {
    await live.close();
  }
}
