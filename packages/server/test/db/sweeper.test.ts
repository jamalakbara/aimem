import { readClaim } from "@aimem/core";
import type { RunningServer } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStream, type SseEvent } from "../sse-client.js";
import {
  age,
  assertInvariants,
  client,
  freshDb,
  newTask,
  secondServer,
  server,
  sleep,
  type TestDb,
  token,
  waitForLockWaiters,
} from "./helpers.js";

/**
 * 6.1b sweeper (plan §4, §5, todo 20): one transaction per claim under the task lock, `claim.expired` once, the
 * claim stays recorded and the takeover rules do not change. PostgreSQL only, in the CI job `server`.
 * IDs from qa-review.md: KL-4 and KL-6 with the sweeper, plus the event over SSE.
 */
let db: TestDb;
let srv: RunningServer;
let srv2: RunningServer;
// biome-ignore lint/suspicious/noExplicitAny: test clients
let dana: any, rina: any;
let reader: string;
/** A barrier inside one operation on one task: the test decides when it may go on. */
let hold: { op: string; point: string; task: string; reached: () => void; go: Promise<void> } | undefined;

beforeAll(async () => {
  db = await freshDb();
  srv = await server(db, {
    at: async (point, info) => {
      if (hold && point === hold.point && info.op === hold.op && info.task === hold.task) {
        const h = hold;
        hold = undefined;
        h.reached();
        await h.go;
      }
    },
  });
  srv2 = await secondServer(db);
  dana = client(srv.url, "alpha", await token(db.pool, "alpha", "dana"), "s-dana");
  rina = client(srv2.url, "alpha", await token(db.pool, "alpha", "rina"), "s-rina");
  reader = await token(db.pool, "alpha", "vera", { scopes: ["read"] });
});
afterAll(async () => {
  await assertInvariants(db.pool);
  await srv.close();
  await srv2.close();
  await db.drop();
});

/** Arms a barrier and returns a promise for "reached" and the function that lets it go on. */
function barrier(op: string, point: string, task: string) {
  let reached!: () => void;
  const at = new Promise<void>((d) => {
    reached = d;
  });
  let go!: () => void;
  hold = {
    op,
    point,
    task,
    reached,
    go: new Promise<void>((d) => {
      go = d;
    }),
  };
  return { at, go: () => go() };
}

const expiredEvents = async (task: string) =>
  Number(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM events WHERE type = 'claim.expired' AND payload->'claim'->>'task' = $1",
        [`alpha:${task}`],
      )
    ).rows[0].n,
  );
const openRow = async (task: string) =>
  (
    await db.pool.query(
      "SELECT released_at, released_status, expired_notified_at FROM claims WHERE task_ref = $1 ORDER BY id DESC LIMIT 1",
      [`alpha:${task}`],
    )
  ).rows[0];
/** Ages a claim so that it expires `secondsFromNow` from now (negative: already expired). */
const expireIn = (task: string, secondsFromNow: number) =>
  db.pool.query(
    `UPDATE claims SET heartbeat_at = clock_timestamp() - make_interval(secs => 60 - $2::float8),
                       started_at = clock_timestamp() - make_interval(secs => 60 - $2::float8),
                       expires_at = clock_timestamp() + make_interval(secs => $2::float8)
      WHERE task_ref = $1 AND released_at IS NULL`,
    [`alpha:${task}`, secondsFromNow],
  );

describe("claim.expired, once, and the claim stays (plan §4, todo 20)", () => {
  it("marks an expired claim once, even when swept again and by two instances", async () => {
    const task = newTask();
    expect((await dana.acquire({ task, ttl_minutes: 1 })).status).toBe(201);
    expect(await srv.sweep()).toBeGreaterThanOrEqual(0);
    expect(await expiredEvents(task)).toBe(0);
    await age(db.pool, `alpha:${task}`, 2);
    await Promise.all([srv.sweep(), srv2.sweep(), srv.sweep()]);
    await srv2.sweep();
    expect(await expiredEvents(task)).toBe(1);
    const row = await openRow(task);
    expect(row.released_at).toBeNull();
    expect(row.expired_notified_at).not.toBeNull();
    const live = (await rina.live()).json.claims.find((c: { task: string }) => c.task === `alpha:${task}`);
    expect(live).toMatchObject({ holder: "human:dana", expired: true });
    const audit = await db.pool.query(
      "SELECT actor FROM audit_log WHERE action = 'claim.expired' AND target = $1",
      [`alpha:${task}`],
    );
    expect(audit.rows.map((r) => r.actor)).toEqual(["system:sweeper"]);
    await assertInvariants(db.pool);
  });

  it("does not touch active or released claims", async () => {
    const active = newTask();
    const released = newTask();
    await dana.acquire({ task: active, ttl_minutes: 1 });
    await dana.acquire({ task: released, ttl_minutes: 1 });
    await age(db.pool, `alpha:${released}`, 2);
    expect((await dana.release(released)).json).toEqual({ released: true });
    await srv.sweep();
    expect([await expiredEvents(active), await expiredEvents(released)]).toEqual([0, 0]);
    expect((await openRow(active)).expired_notified_at).toBeNull();
  });

  it("is sent over SSE with the claim marked expired (KT-1 for claim.expired)", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    const s = await openStream(srv2.url, "/v1/projects/alpha/events", { token: reader });
    expect(s.status).toBe(200);
    await age(db.pool, `alpha:${task}`, 2);
    await srv.sweep();
    const events = await s.waitFor((e) => e.some((x) => x.data.claim?.task === `alpha:${task}`), 3_000);
    const e = events.find((x) => x.data.claim.task === `alpha:${task}`) as SseEvent;
    expect([e.event, e.data.type, e.id]).toEqual(["claim.expired", "claim.expired", String(e.data.seq)]);
    expect(Object.keys(e.data).sort()).toEqual(["at", "claim", "seq", "type"]);
    expect(e.data.claim).toMatchObject({ holder: "human:dana", expired: true });
    const { expired, expiresAt, ...rest } = e.data.claim;
    expect(readClaim(JSON.stringify(rest), { id: task, task: `alpha:${task}` })).toEqual(rest);
    expect(Date.parse(expiresAt)).toBeLessThanOrEqual(Date.parse(e.data.at));
    s.close();
  });
});

describe("the expiry table is the same with the sweeper run before each action (KL-4)", () => {
  const outcome = async (minutesAgo: number, sweepFirst: boolean) => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await age(db.pool, `alpha:${task}`, minutesAgo);
    const step = async (f: () => Promise<{ status: number }>) => {
      if (sweepFirst) await srv.sweep();
      return (await f()).status;
    };
    return {
      task,
      r: {
        ownerAcquire: await step(() => dana.acquire({ task })),
        otherAcquire: await step(() => rina.acquire({ task })),
        ownerHeartbeat: await step(() => dana.heartbeat(task)),
        otherHeartbeat: await step(() => rina.heartbeat(task)),
        otherSteal: await step(() => rina.acquire({ task, steal: true })),
      },
    };
  };

  for (const sweepFirst of [false, true])
    it(`active, expired within the allowance, past it (sweeper before each action: ${sweepFirst})`, async () => {
      const active = await outcome(0, sweepFirst);
      expect(active.r).toEqual({
        ownerAcquire: 200,
        otherAcquire: 409,
        ownerHeartbeat: 200,
        otherHeartbeat: 409,
        otherSteal: 409,
      });
      const grace = await outcome(2, sweepFirst);
      expect(grace.r).toEqual({
        ownerAcquire: 409,
        otherAcquire: 409,
        ownerHeartbeat: 409,
        otherHeartbeat: 409,
        otherSteal: 409,
      });
      const past = await outcome(7, sweepFirst);
      expect(past.r).toEqual({
        ownerAcquire: 409,
        otherAcquire: 409,
        ownerHeartbeat: 409,
        otherHeartbeat: 409,
        otherSteal: 201,
      });
      // With the sweeper, each expired claim was reported once; without it, never. The new claim is active.
      expect(await expiredEvents(active.task)).toBe(0);
      expect(await expiredEvents(grace.task)).toBe(sweepFirst ? 1 : 0);
      expect(await expiredEvents(past.task)).toBe(sweepFirst ? 1 : 0);
      expect((await openRow(grace.task)).released_at).toBeNull();
      // The old owner may still release an expired, reported claim.
      expect((await dana.release(grace.task)).json).toEqual({ released: true });
      await assertInvariants(db.pool);
    });

  it("a takeover after the report carries the previous holder and is not reported again", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await age(db.pool, `alpha:${task}`, 7);
    await srv.sweep();
    expect((await rina.acquire({ task, steal: true })).status).toBe(201);
    await srv.sweep();
    expect(await expiredEvents(task)).toBe(1);
    const types = await db.pool.query(
      "SELECT type, payload->>'previous_holder' AS prev FROM events WHERE payload->'claim'->>'task' = $1 ORDER BY seq",
      [`alpha:${task}`],
    );
    expect(types.rows.map((r) => [r.type, r.prev])).toEqual([
      ["claim.created", null],
      ["claim.expired", null],
      ["claim.taken_over", "human:dana"],
    ]);
  });
});

describe("sweeper and other writers on the same task (KL-6)", () => {
  it("sweeper first, heartbeat waits on the lock: one claim.expired, heartbeat refused", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await expireIn(task, -1);
    const b = barrier("expire", "locked", `alpha:${task}`);
    const sweeping = srv.sweep();
    await b.at;
    const hb = dana.heartbeat(task);
    await waitForLockWaiters(db, 1);
    b.go();
    await sweeping;
    expect((await hb).status).toBe(409);
    expect(await expiredEvents(task)).toBe(1);
    expect((await openRow(task)).released_at).toBeNull();
  });

  it("heartbeat first (still active), sweeper waits on the lock: heartbeat 200, nothing reported", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await expireIn(task, 1.5);
    // The heartbeat has read its time (active) and holds the lock past the old expiry.
    const b = barrier("heartbeat", "read", `alpha:${task}`);
    const hb = dana.heartbeat(task);
    await b.at;
    await sleep(2_000);
    const sweeping = srv2.sweep();
    await waitForLockWaiters(db, 1);
    b.go();
    expect((await hb).status).toBe(200);
    await sweeping;
    expect(await expiredEvents(task)).toBe(0);
    expect((await openRow(task)).expired_notified_at).toBeNull();
  });

  it("two sweepers at once on two instances: one event", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await expireIn(task, -1);
    const b = barrier("expire", "locked", `alpha:${task}`);
    const first = srv.sweep();
    await b.at;
    const second = srv2.sweep();
    await waitForLockWaiters(db, 1);
    b.go();
    await Promise.all([first, second]);
    expect(await expiredEvents(task)).toBe(1);
    await assertInvariants(db.pool);
  });

  it("release while the sweeper waits: nothing reported for a released claim", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await expireIn(task, -1);
    const b = barrier("release", "read", `alpha:${task}`);
    const rel = dana.release(task);
    await b.at;
    const sweeping = srv2.sweep();
    await waitForLockWaiters(db, 1);
    b.go();
    expect((await rel).json).toEqual({ released: true });
    await sweeping;
    expect(await expiredEvents(task)).toBe(0);
    await assertInvariants(db.pool);
  });
});

describe("the sweeper on a timer", () => {
  it("runs by itself when an interval is set, and stops on close", async () => {
    const { startServer } = await import("@aimem/server");
    const timed = await startServer({ pool: db.pool, sweepMs: 200 });
    try {
      const task = newTask();
      await dana.acquire({ task, ttl_minutes: 1 });
      await age(db.pool, `alpha:${task}`, 2);
      const end = Date.now() + 5_000;
      while ((await expiredEvents(task)) === 0 && Date.now() < end) await sleep(50);
      expect(await expiredEvents(task)).toBe(1);
    } finally {
      await timed.close();
    }
  });
});
