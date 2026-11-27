import { anyPathOverlap } from "@aimem/core";
import type { Caller } from "./auth.js";
import { type Client, inTx, type Pool } from "./db.js";
import { type Decision, decide, expireDue, expiresAt, type OpenClaim, type Owner } from "./decide.js";
import type { HookInfo, HookPoint, Hooks } from "./hooks.js";
import { HttpError } from "./problem.js";
import type { AcquireInput } from "./validate.js";

/** The claim as clients see it: core's `TaskClaim` plus `expired` and `expiresAt` (plan §6.2). */
export interface ClaimView {
  task: string;
  holder: string;
  on_behalf_of?: string;
  session: string;
  paths?: string[];
  note?: string;
  started: string;
  heartbeat: string;
  ttl_minutes: number;
  expired: boolean;
  expiresAt: string;
}

interface Row {
  id: string;
  task_ref: string;
  owner_user_id: string;
  holder: string;
  on_behalf_of: string | null;
  session: string;
  paths: string[] | null;
  note: string | null;
  started_at: Date;
  heartbeat_at: Date;
  ttl_minutes: number;
  expired_notified_at: Date | null;
}

/** The audit actor of the sweeper; it is no token holder. */
export const SWEEPER_ACTOR = "system:sweeper";
/** Claims the sweeper handles per run; the rest wait for the next run. */
export const SWEEP_BATCH = 500;

export interface Outcome {
  status: number;
  body: unknown;
}

/** Every writer of one task takes this lock first (plan A9, QA W2). Exported for the lock test. */
// PostgreSQL text cannot hold NUL; a project ID is digits and a task ref has no "/", so this is unambiguous.
export const taskLockKey = (projectId: string, task: string) => `${projectId}/${task}`;

const open = (r: Row): OpenClaim => ({
  userId: String(r.owner_user_id),
  holder: r.holder,
  session: r.session,
  heartbeat: r.heartbeat_at,
  ttlMinutes: r.ttl_minutes,
});

export function view(r: Row, t: Date): ClaimView {
  const expires = expiresAt(open(r));
  return {
    task: r.task_ref,
    holder: r.holder,
    ...(r.on_behalf_of ? { on_behalf_of: r.on_behalf_of } : {}),
    session: r.session,
    ...(r.paths ? { paths: r.paths } : {}),
    ...(r.note ? { note: r.note } : {}),
    started: r.started_at.toISOString(),
    heartbeat: r.heartbeat_at.toISOString(),
    ttl_minutes: r.ttl_minutes,
    expired: t.getTime() >= expires,
    expiresAt: new Date(expires).toISOString(),
  };
}

const conflict = (r: Row, message: string) =>
  new HttpError(409, "CLAIM_CONFLICT", message, { holder: r.holder, since: r.started_at.toISOString() });

function fail(d: Decision, current: Row | undefined): never {
  if ("error" in d) {
    if (d.error === "not_found" || !current) throw new HttpError(404, "NOT_FOUND", d.message);
    throw conflict(current, d.message);
  }
  throw new Error("not a failure");
}

class UniqueViolation extends Error {}

export class Claims {
  constructor(
    private readonly pool: Pool,
    private readonly hooks: Hooks = {},
  ) {}

  /** A writing transaction; tests may replace its COMMIT (hooks.commit). */
  private tx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    return inTx(this.pool, fn, "BEGIN ISOLATION LEVEL READ COMMITTED", this.hooks.commit?.bind(this.hooks));
  }

  private async hook(point: HookPoint, info: HookInfo) {
    await this.hooks.at?.(point, info);
  }

  /** Lock, then server time taken after the lock (QA W2), then the open claim of the task. */
  private async begin(c: Client, caller: Caller, task: string, info: HookInfo) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      taskLockKey(caller.projectId, task),
    ]);
    await this.hook("locked", info);
    const t = (await c.query("SELECT clock_timestamp() AS t")).rows[0].t as Date;
    const current = (
      await c.query(
        "SELECT * FROM claims WHERE project_id = $1 AND task_ref = $2 AND released_at IS NULL FOR UPDATE",
        [caller.projectId, task],
      )
    ).rows[0] as Row | undefined;
    await this.hook("read", info);
    return { t, current };
  }

  /** One event and one audit row in the same transaction; the event number is locked until commit (QA W5). */
  private async record(
    c: Client,
    caller: Caller,
    info: HookInfo,
    type: string,
    claim: ClaimView,
    t: Date,
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    const seqRow = await c.query(
      "UPDATE project_event_seq SET last_seq = last_seq + 1 WHERE project_id = $1 RETURNING last_seq",
      [caller.projectId],
    );
    if (seqRow.rowCount !== 1) throw new Error("project has no event counter");
    const seq = Number(seqRow.rows[0].last_seq);
    await this.hook("seq", info);
    await this.hook("beforeEvent", info);
    const payload = { seq, type, at: t.toISOString(), claim, ...extra };
    await c.query("INSERT INTO events (project_id, seq, type, payload, at) VALUES ($1, $2, $3, $4, $5)", [
      caller.projectId,
      seq,
      type,
      payload,
      t,
    ]);
    // Only the address of the event: its content may be larger than NOTIFY allows (QA W7).
    await c.query("SELECT pg_notify('aimem_events', $1)", [
      JSON.stringify({ project_id: caller.projectId, seq }),
    ]);
    await c.query(
      "INSERT INTO audit_log (project_id, actor, action, target, at, meta) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        caller.projectId,
        caller.holder,
        type,
        claim.task,
        t,
        { seq, user: caller.userId, session: claim.session },
      ],
    );
    return seq;
  }

  private async insert(
    c: Client,
    caller: Caller,
    input: AcquireInput,
    session: string,
    t: Date,
  ): Promise<Row> {
    try {
      await c.query("SAVEPOINT claim_insert");
      const r = await c.query(
        `INSERT INTO claims (project_id, task_ref, owner_user_id, holder, on_behalf_of, session, paths, note,
                             started_at, heartbeat_at, ttl_minutes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz, $10::int, $9::timestamptz + make_interval(mins => $10::int))
         RETURNING *`,
        [
          caller.projectId,
          input.task,
          caller.userId,
          caller.holder,
          caller.onBehalfOf ?? null,
          session,
          input.paths ?? null,
          input.note ?? null,
          t,
          input.ttlMinutes,
        ],
      );
      await c.query("RELEASE SAVEPOINT claim_insert");
      return r.rows[0] as Row;
    } catch (e) {
      // The second guard: the unique index holds even if the lock did not (QA W9, KL-2).
      if ((e as { code?: string }).code === "23505") throw new UniqueViolation();
      throw e;
    }
  }

  private async overlaps(c: Client, caller: Caller, claim: Row, t: Date) {
    if (!claim.paths) return [];
    const others = (
      await c.query(
        "SELECT * FROM claims WHERE project_id = $1 AND released_at IS NULL AND paths IS NOT NULL AND task_ref <> $2",
        [caller.projectId, claim.task_ref],
      )
    ).rows as Row[];
    return others
      .filter(
        (o) =>
          !(String(o.owner_user_id) === caller.userId && o.holder === caller.holder) &&
          t.getTime() < expiresAt(open(o)) &&
          anyPathOverlap(claim.paths ?? [], o.paths ?? []),
      )
      .map((o) => ({ ref: o.task_ref, holder: o.holder, paths: o.paths ?? [] }));
  }

  async acquire(caller: Caller, session: string, input: AcquireInput): Promise<Outcome> {
    const me: Owner = { userId: caller.userId, holder: caller.holder, session };
    const info = (c: Client): HookInfo => ({ op: "acquire", task: input.task, client: c });
    let out: { status: number; body: unknown; changed: boolean };
    try {
      out = await this.tx(async (c) => {
        const { t, current } = await this.begin(c, caller, input.task, info(c));
        const d = decide(current && open(current), { kind: "acquire", steal: input.steal, me }, t);
        if ("error" in d) fail(d, current);
        if (d.do === "same" && current) {
          const claim = view(current, t);
          await this.hook("beforeCommit", info(c));
          return { status: 200, body: { claim, overlaps: [], warnings: [] }, changed: false };
        }
        if (d.do === "takeover" && current) {
          const r = await c.query(
            "UPDATE claims SET released_at = $2, released_status = 'taken_over' WHERE id = $1 AND released_at IS NULL",
            [current.id, t],
          );
          if (r.rowCount !== 1) throw new Error("claim changed under its lock");
        }
        const row = await this.insert(c, caller, input, session, t);
        const claim = view(row, t);
        await this.record(
          c,
          caller,
          info(c),
          d.do === "takeover" ? "claim.taken_over" : "claim.created",
          claim,
          t,
          d.do === "takeover" && current ? { previous_holder: current.holder } : {},
        );
        const overlaps = await this.overlaps(c, caller, row, t);
        await this.hook("beforeCommit", info(c));
        return {
          status: 201,
          body: {
            claim,
            overlaps,
            warnings: overlaps.map(
              (o) => `Paths overlap ${o.ref} held by ${o.holder} (${o.paths.join(", ")}).`,
            ),
          },
          changed: true,
        };
      });
    } catch (e) {
      if (!(e instanceof UniqueViolation)) throw e;
      const current = (
        await this.pool.query(
          "SELECT * FROM claims WHERE project_id = $1 AND task_ref = $2 AND released_at IS NULL",
          [caller.projectId, input.task],
        )
      ).rows[0] as Row | undefined;
      if (!current)
        throw new HttpError(503, "SYNC_FAILED", "The claim changed at the same time; try again.", undefined, {
          "Retry-After": "1",
        });
      throw conflict(current, `The task is claimed by ${current.holder}.`);
    }
    return out;
  }

  async heartbeat(caller: Caller, session: string, task: string): Promise<Outcome> {
    const me: Owner = { userId: caller.userId, holder: caller.holder, session };
    return this.tx(async (c) => {
      const info: HookInfo = { op: "heartbeat", task, client: c };
      const { t, current } = await this.begin(c, caller, task, info);
      const d = decide(current && open(current), { kind: "heartbeat", me }, t);
      if ("error" in d) fail(d, current);
      if (!current) throw new Error("unreachable");
      if (d.do === "unchanged") {
        await this.hook("beforeCommit", info);
        return { status: 200, body: { claim: view(current, t) } };
      }
      const r = await c.query(
        "UPDATE claims SET heartbeat_at = $2::timestamptz, expires_at = $2::timestamptz + make_interval(mins => ttl_minutes) WHERE id = $1 AND released_at IS NULL RETURNING *",
        [current.id, t],
      );
      if (r.rowCount !== 1) throw new Error("claim changed under its lock");
      const claim = view(r.rows[0] as Row, t);
      await this.record(c, caller, info, "claim.heartbeat", claim, t);
      await this.hook("beforeCommit", info);
      return { status: 200, body: { claim } };
    });
  }

  async release(caller: Caller, session: string, task: string): Promise<Outcome> {
    const me: Owner = { userId: caller.userId, holder: caller.holder, session };
    return this.tx(async (c) => {
      const info: HookInfo = { op: "release", task, client: c };
      const { t, current } = await this.begin(c, caller, task, info);
      const d = decide(current && open(current), { kind: "release", me }, t);
      if ("error" in d) fail(d, current);
      if (d.do === "none" || !current) return { status: 200, body: { released: false } };
      const r = await c.query(
        "UPDATE claims SET released_at = $2, released_status = 'released' WHERE id = $1 AND released_at IS NULL",
        [current.id, t],
      );
      if (r.rowCount !== 1) throw new Error("claim changed under its lock");
      await this.record(c, caller, info, "claim.released", view(current, t), t);
      await this.hook("beforeCommit", info);
      return { status: 200, body: { released: true } };
    });
  }

  /**
   * One sweeper step for one claim, in its own transaction under the task lock (plan §5, A9): if the open claim is
   * at or past its expiry and not reported yet, mark it and write one `claim.expired` with its audit row. The
   * claim is not released, so the takeover rules stay as they are. Returns whether an event was written.
   */
  async expire(projectId: string, task: string): Promise<boolean> {
    const system: Caller = { projectId, slug: "", userId: "", holder: SWEEPER_ACTOR, tokenId: "" };
    return this.tx(async (c) => {
      const info: HookInfo = { op: "expire", task, client: c };
      const { t, current } = await this.begin(c, system, task, info);
      if (!current || !expireDue(open(current), current.expired_notified_at, t)) {
        await this.hook("beforeCommit", info);
        return false;
      }
      const r = await c.query(
        "UPDATE claims SET expired_notified_at = $2 WHERE id = $1 AND released_at IS NULL AND expired_notified_at IS NULL",
        [current.id, t],
      );
      if (r.rowCount !== 1) throw new Error("claim changed under its lock");
      await this.record(c, system, info, "claim.expired", view(current, t), t);
      await this.hook("beforeCommit", info);
      return true;
    });
  }

  /**
   * One sweeper run over every project: candidates are read without a lock, then each one is decided again under
   * its task lock, so two instances sweeping at once still write one event per claim. Returns the events written.
   */
  async sweep(limit = SWEEP_BATCH): Promise<number> {
    const due = await this.pool.query(
      `SELECT project_id, task_ref FROM claims
        WHERE released_at IS NULL AND expired_notified_at IS NULL AND expires_at <= clock_timestamp()
        ORDER BY expires_at LIMIT $1`,
      [limit],
    );
    let written = 0;
    for (const row of due.rows)
      if (await this.expire(String(row.project_id), String(row.task_ref))) written++;
    return written;
  }

  /** Claims and the cursor from one snapshot: every change up to `cursor` is reflected (plan §5). */
  async live(caller: Caller): Promise<Outcome> {
    return inTx(
      this.pool,
      async (c) => {
        const t = (await c.query("SELECT clock_timestamp() AS t")).rows[0].t as Date;
        const seq = await c.query("SELECT last_seq FROM project_event_seq WHERE project_id = $1", [
          caller.projectId,
        ]);
        const rows = (
          await c.query(
            "SELECT * FROM claims WHERE project_id = $1 AND released_at IS NULL ORDER BY task_ref",
            [caller.projectId],
          )
        ).rows as Row[];
        return {
          status: 200,
          body: { cursor: Number(seq.rows[0]?.last_seq ?? 0), claims: rows.map((r) => view(r, t)) },
        };
      },
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  }
}
