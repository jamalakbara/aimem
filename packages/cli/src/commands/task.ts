import {
  AimemError,
  acquireClaim,
  ageLabel,
  type ClaimResult,
  heartbeatTaskClaim,
  type LiveClaim,
  listUnsyncedClaims,
  loadIndex,
  loadProject,
  type Notebook,
  readLiveClaims,
  reconcileLocalClaims,
  releaseTaskClaim,
  resolveAuthorWithGit,
  saveLocalClaim,
  type TaskClaimInput,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { table } from "../output.js";
import { currentAuthor } from "./session.js";

interface ClaimOptions {
  author?: string;
  session?: string;
  offline?: boolean;
}

function holderLabel(claim: LiveClaim): string {
  return claim.participants ? claim.participants.map((p) => p.holder).join(", ") : claim.holder;
}

function claimLabel(claim: LiveClaim): string {
  return "task" in claim ? claim.task : `${claim.id} (${claim.paths.join(", ")})`;
}

/** Publish saved `--local` claims before an online claim command (07 §2.4). */
async function reconcile(deps: CliDeps, nb: Notebook, offline?: boolean): Promise<string[]> {
  return offline ? [] : reconcileLocalClaims(nb, deps);
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
  o: ClaimOptions & {
    paths?: string;
    note?: string;
    ttl?: string;
    steal?: boolean;
    share?: boolean;
    local?: boolean;
  },
): Promise<CommandResult> {
  if (o.ttl !== undefined && !/^\d+m$/.test(o.ttl)) {
    throw new AimemError("USAGE", "Claim TTL must be given in whole minutes, for example 180m.");
  }
  const nb = await loadProject(deps.fs, g.dir);
  const paths = o.paths
    ?.split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  const input: TaskClaimInput = {
    ...(await claimIdentity(deps, nb.root, o)),
    ...(paths === undefined ? {} : { paths }),
    ...(o.note === undefined ? {} : { note: o.note }),
    ...(o.ttl === undefined ? {} : { ttlMinutes: Number(o.ttl.slice(0, -1)) }),
    ...(o.steal ? { steal: true } : {}),
    ...(o.share ? { share: true } : {}),
  };
  let synced: string[] = [];
  let result: ClaimResult;
  if (o.local && o.offline) {
    result = await saveLocalClaim(nb, ref, input, deps);
  } else {
    if (o.local && (o.steal || o.share)) {
      throw new AimemError("USAGE", "--local cannot be combined with --steal or --share.");
    }
    try {
      synced = await reconcile(deps, nb, o.offline);
      result = await acquireClaim(nb, ref, input, deps);
    } catch (error) {
      // 07 §2.4: with --local, an unreachable remote saves an unsynced claim instead of failing.
      if (!o.local || !(error instanceof AimemError) || error.code !== "SYNC_FAILED") throw error;
      result = await saveLocalClaim(nb, ref, input, deps);
    }
  }
  const { claim, session, overlaps, warnings } = result;
  const text = claim.unsynced
    ? `Saved an unsynced local claim for ${claimLabel(claim)} (session ${claim.session}).\n`
    : claim.shared
      ? `Holding the shared claim for ${claimLabel(claim)} (session ${session}). Participants: ${holderLabel(claim)}.\n`
      : `Claimed ${claimLabel(claim)} for ${claim.holder} (session ${claim.session}).\n`;
  return { data: { claim, overlaps }, text, warnings: [...synced, ...warnings] };
}

export async function taskHeartbeat(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: ClaimOptions,
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const identity = await claimIdentity(deps, nb.root, o);
  const synced = await reconcile(deps, nb, o.offline);
  const claim = await heartbeatTaskClaim(nb, ref, identity, deps);
  return {
    data: { claim },
    text: `Extended the claim for ${claimLabel(claim)} at ${claim.heartbeat}.\n`,
    warnings: synced,
  };
}

export async function taskRelease(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: ClaimOptions,
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const identity = await claimIdentity(deps, nb.root, o);
  const synced = await reconcile(deps, nb, o.offline);
  const released = await releaseTaskClaim(nb, ref, identity, deps);
  return {
    data: { released },
    text: released ? `Released the claim for ${ref}.\n` : `No live claim for ${ref}.\n`,
    warnings: synced,
  };
}

export async function liveClaims(
  deps: CliDeps,
  g: GlobalOptions,
  o: { offline?: boolean },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const synced = await reconcile(deps, nb, o.offline);
  // Offline, `live` lists only unsynced local claims; online, it adds any that could not sync yet.
  const remote = o.offline ? { claims: [], warnings: [] } : await readLiveClaims(nb, false, deps);
  const local = await listUnsyncedClaims(nb, deps);
  const now = deps.clock.now().getTime();
  const claims = [
    ...remote.claims,
    ...local.claims.map((claim) => {
      const expires = Date.parse(claim.heartbeat) + claim.ttl_minutes * 60_000;
      return { ...claim, expired: now >= expires, expiresAt: new Date(expires).toISOString() };
    }),
  ];
  const warnings = [
    ...synced,
    ...remote.warnings,
    ...local.invalid.map((file) => `Skipped unreadable unsynced claim file ${file}.`),
  ];
  // Human output: words, not colour, for every state; exact ISO times stay in --json.
  const index = claims.length ? await loadIndex(nb, { fs: deps.fs }) : undefined;
  const me = claims.length ? await currentAuthor(deps, nb.root) : undefined;
  const rows = claims.map((claim) => {
    const ref = "task" in claim ? claim.task.replace(`${nb.config.project}:`, "") : claim.id;
    const record =
      "task" in claim ? index?.records.find((r) => r.type === "task" && r.id === ref) : undefined;
    const title = record ? record.title : "task" in claim ? "" : "(paths only)";
    const holders = claim.participants ? claim.participants.map((p) => p.holder) : [claim.holder];
    const status = [
      claim.expired ? "possibly abandoned" : "active",
      claim.shared ? `shared · ${holders.length} participants` : "",
      "unsynced" in claim ? "unsynced" : "",
    ].filter(Boolean);
    return [
      ref,
      title.length > 30 ? `${title.slice(0, 29)}…` : title,
      `${holders.join(", ")}${me && holders.includes(me) ? " (you)" : ""}`,
      (claim.paths ?? ["—"]).join(", "),
      ageLabel(now - Date.parse(claim.started)),
      claim.expired ? "—" : ageLabel(Date.parse(claim.expiresAt) - now),
      status.join(", "),
    ];
  });
  return {
    data: { claims },
    text: rows.length
      ? table(["REF", "TITLE", "HOLDER", "PATHS", "SINCE", "EXPIRES IN", "STATUS"], rows)
      : "No live claims.\n",
    warnings,
  };
}
