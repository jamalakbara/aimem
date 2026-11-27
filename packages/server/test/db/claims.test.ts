import { readClaim } from "@aimem/core";
import { newToken, type RunningServer, taskLockKey } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  age,
  assertInvariants,
  call,
  client,
  counts,
  freshDb,
  holdTaskLock,
  newTask,
  server,
  sleep,
  type TestDb,
  token,
  waitForLockWaiters,
} from "./helpers.js";

let db: TestDb;
let srv: RunningServer;
let dropNext: string | undefined;
let failCommitFor: string | undefined;
let alphaId: string;
// biome-ignore lint/suspicious/noExplicitAny: clients of the test project
let dana: any, rina: any, bot1: any, bot2: any, beta: any;

beforeAll(async () => {
  db = await freshDb();
  srv = await server(db, {
    at: async (point, info) => {
      // KL-7 (1): the database connection is lost just before commit.
      if (point === "beforeCommit" && info.task === failCommitFor) {
        const pid = (await info.client.query("SELECT pg_backend_pid() AS p")).rows[0].p;
        await db.pool.query("SELECT pg_terminate_backend($1)", [pid]);
        // Wait until the backend is really gone, so the commit cannot slip through first.
        for (let i = 0; i < 200; i++) {
          const r = await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1", [
            pid,
          ]);
          if (r.rows[0].n === 0) break;
          await sleep(10);
        }
      }
    },
    afterCommit: (info) => {
      // KL-7 (2): the change is stored, the response is lost.
      if (info.task === dropNext) {
        dropNext = undefined;
        info.drop();
      }
    },
  });
  dana = client(srv.url, "alpha", await token(db.pool, "alpha", "dana"), "s-dana");
  rina = client(srv.url, "alpha", await token(db.pool, "alpha", "rina"), "s-rina");
  // Two users with an agent token of the same name (QA W3).
  bot1 = client(
    srv.url,
    "alpha",
    await token(db.pool, "alpha", "u1", { kind: "agent", name: "bot" }),
    "same-session",
  );
  bot2 = client(
    srv.url,
    "alpha",
    await token(db.pool, "alpha", "u2", { kind: "agent", name: "bot" }),
    "same-session",
  );
  beta = client(srv.url, "beta", await token(db.pool, "beta", "rina"), "s-rina");
  alphaId = (await db.pool.query("SELECT id FROM projects WHERE slug = 'alpha'")).rows[0].id;
});
afterAll(async () => {
  await assertInvariants(db.pool);
  await srv.close();
  await db.drop();
});

const KEYS = [
  "task",
  "holder",
  "on_behalf_of",
  "session",
  "paths",
  "note",
  "started",
  "heartbeat",
  "ttl_minutes",
  "expired",
  "expiresAt",
];
/** KT-1: core's reader accepts it, the keys are exactly the contract, and expired/expiresAt are consistent. */
function checkContract(claim: Record<string, unknown>, now = Date.now()) {
  expect(Object.keys(claim).every((k) => KEYS.includes(k))).toBe(true);
  const id = String(claim.task).split(":")[1] ?? "";
  const { expired, expiresAt, ...rest } = claim;
  expect(readClaim(JSON.stringify(rest), { id, task: String(claim.task) })).toEqual(rest);
  expect(expiresAt).toBe(
    new Date(Date.parse(String(claim.heartbeat)) + Number(claim.ttl_minutes) * 60_000).toISOString(),
  );
  expect(expired).toBe(now >= Date.parse(String(expiresAt)));
  for (const k of ["started", "heartbeat", "expiresAt"])
    expect(String(claim[k])).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
}
const PROBLEM_KEYS = ["code", "detail", "details", "status", "title", "type"];
function checkProblem(r: { status: number; headers: Headers; json: Record<string, unknown> }, code: string) {
  expect(r.headers.get("content-type")).toBe("application/problem+json");
  expect(Object.keys(r.json).every((k) => PROBLEM_KEYS.includes(k))).toBe(true);
  expect([r.json.status, r.json.code]).toEqual([r.status, code]);
}

describe("acquire, heartbeat, release (plan §4, §6)", () => {
  it("creates a claim with the holder from the token and the contract shape (KT-1)", async () => {
    const task = newTask();
    const r = await bot1.acquire({
      task,
      paths: ["src/api/**"],
      note: "making it idempotent",
      ttl_minutes: 30,
    });
    expect(r.status).toBe(201);
    checkContract(r.json.claim);
    expect(r.json.claim).toMatchObject({
      task: `alpha:${task}`,
      holder: "agent:bot",
      on_behalf_of: "human:u1",
      session: "same-session",
      paths: ["src/api/**"],
      note: "making it idempotent",
      ttl_minutes: 30,
      expired: false,
    });
    expect(r.json).toMatchObject({ overlaps: [], warnings: [] });
    const live = await rina.live();
    expect(live.status).toBe(200);
    const mine = live.json.claims.find((c: { task: string }) => c.task === `alpha:${task}`);
    checkContract(mine);
    expect(mine).toEqual(r.json.claim);
    const event = await db.pool.query("SELECT payload FROM events WHERE payload->'claim'->>'task' = $1", [
      `alpha:${task}`,
    ]);
    expect(event.rowCount).toBe(1);
    checkContract(event.rows[0].payload.claim);
    expect(event.rows[0].payload).toMatchObject({ type: "claim.created", claim: r.json.claim });
  });

  it("acquire again by the same owner returns the same claim without an event", async () => {
    const task = newTask();
    const a = await dana.acquire({ task });
    const before = await counts(db.pool);
    const b = await dana.acquire({ task });
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.json.claim).toEqual(a.json.claim);
    expect(await counts(db.pool)).toEqual(before);
    const other = await dana.acquire({ task }, "s-other");
    expect(other.status).toBe(409);
    checkProblem(other, "CLAIM_CONFLICT");
    expect(other.json.details).toEqual({ holder: "human:dana", since: a.json.claim.started });
  });

  it("heartbeat moves the expiry; release frees the task; releasing nothing is not an error", async () => {
    const task = newTask();
    const a = await dana.acquire({ task, ttl_minutes: 5 });
    await sleep(5);
    const h = await dana.heartbeat(task);
    expect(h.status).toBe(200);
    checkContract(h.json.claim);
    expect(Date.parse(h.json.claim.heartbeat)).toBeGreaterThan(Date.parse(a.json.claim.heartbeat));
    expect(h.json.claim.started).toBe(a.json.claim.started);
    expect((await rina.release(task)).status).toBe(409);
    expect((await dana.release(task)).json).toEqual({ released: true });
    expect((await dana.release(task)).json).toEqual({ released: false });
    expect((await rina.release(newTask())).json).toEqual({ released: false });
    const hb = await dana.heartbeat(task);
    expect(hb.status).toBe(404);
    checkProblem(hb, "NOT_FOUND");
    expect((await rina.acquire({ task })).status).toBe(201);
  });

  it("follows the expiry table at each state, with and without steal (KL-4)", async () => {
    const outcome = async (minutesAgo: number) => {
      const task = newTask();
      await dana.acquire({ task, ttl_minutes: 1 });
      await age(db.pool, `alpha:${task}`, minutesAgo);
      const r = {
        ownerAcquire: (await dana.acquire({ task })).status,
        otherAcquire: (await rina.acquire({ task })).status,
        ownerHeartbeat: (await dana.heartbeat(task)).status,
        otherHeartbeat: (await rina.heartbeat(task)).status,
        otherSteal: (await rina.acquire({ task, steal: true })).status,
      };
      const live = (await rina.live()).json.claims.find((c: { task: string }) => c.task === `alpha:${task}`);
      return { r, live, task };
    };
    const active = await outcome(0);
    expect(active.r).toEqual({
      ownerAcquire: 200,
      otherAcquire: 409,
      ownerHeartbeat: 200,
      otherHeartbeat: 409,
      otherSteal: 409,
    });
    // Expired (2 minutes after a 1-minute TTL heartbeat): still recorded, nobody gets it yet.
    const grace = await outcome(2);
    expect(grace.r).toEqual({
      ownerAcquire: 409,
      otherAcquire: 409,
      ownerHeartbeat: 409,
      otherHeartbeat: 409,
      otherSteal: 409,
    });
    expect(grace.live).toMatchObject({ holder: "human:dana", expired: true });
    checkContract(grace.live);
    // Past expiry + 5 minutes: only an explicit steal takes it over.
    const past = await outcome(7);
    expect(past.r).toEqual({
      ownerAcquire: 409,
      otherAcquire: 409,
      ownerHeartbeat: 409,
      otherHeartbeat: 409,
      otherSteal: 201,
    });
    const ev = await db.pool.query(
      "SELECT payload FROM events WHERE type = 'claim.taken_over' AND payload->'claim'->>'task' = $1",
      [`alpha:${past.task}`],
    );
    expect(ev.rows[0].payload).toMatchObject({
      previous_holder: "human:dana",
      claim: { holder: "human:rina" },
    });
    // The old owner may still release an expired claim.
    const t = newTask();
    await dana.acquire({ task: t, ttl_minutes: 1 });
    await age(db.pool, `alpha:${t}`, 2);
    expect((await dana.release(t)).json).toEqual({ released: true });
  });

  it("a heartbeat that waits on the lock past expiry does not revive the claim (KL-5)", async () => {
    const task = newTask();
    await dana.acquire({ task, ttl_minutes: 1 });
    await db.pool.query(
      "UPDATE claims SET started_at = clock_timestamp() - interval '58 seconds', heartbeat_at = clock_timestamp() - interval '58 seconds' WHERE task_ref = $1 AND released_at IS NULL",
      [`alpha:${task}`],
    );
    const lock = await holdTaskLock(db, taskLockKey(alphaId, `alpha:${task}`));
    const pending = dana.heartbeat(task);
    await waitForLockWaiters(db, 1);
    await sleep(3000);
    await lock.release();
    const r = await pending;
    expect(r.status).toBe(409);
    expect(r.json.detail).toMatch(/expired/);
  });

  it("a lost response is safe to repeat: acquire and steal (KL-7)", async () => {
    const task = newTask();
    dropNext = `alpha:${task}`;
    await expect(dana.acquire({ task })).rejects.toThrow();
    const again = await dana.acquire({ task });
    expect(again.status).toBe(200);
    const created = await db.pool.query(
      "SELECT count(*)::int AS n FROM events WHERE payload->'claim'->>'task' = $1",
      [`alpha:${task}`],
    );
    expect(created.rows[0].n).toBe(1);
    // Steal: stored, response lost, repeated by the new owner → 200 without a second takeover.
    await db.pool.query("UPDATE claims SET ttl_minutes = 1 WHERE task_ref = $1 AND released_at IS NULL", [
      `alpha:${task}`,
    ]);
    await age(db.pool, `alpha:${task}`, 7);
    dropNext = `alpha:${task}`;
    await expect(rina.acquire({ task, steal: true })).rejects.toThrow();
    const retry = await rina.acquire({ task, steal: true });
    expect(retry.status).toBe(200);
    expect(retry.json.claim.holder).toBe("human:rina");
    const taken = await db.pool.query(
      "SELECT count(*)::int AS n FROM events WHERE type = 'claim.taken_over' AND payload->'claim'->>'task' = $1",
      [`alpha:${task}`],
    );
    expect(taken.rows[0].n).toBe(1);
    expect((await bot1.acquire({ task, steal: true })).status).toBe(409);
  });

  it("a connection lost before commit leaves nothing behind, and the server recovers (KL-7)", async () => {
    const task = newTask();
    const before = await counts(db.pool);
    failCommitFor = `alpha:${task}`;
    const r = await dana.acquire({ task });
    failCommitFor = undefined;
    expect(r.status).toBe(503);
    checkProblem(r, "SYNC_FAILED");
    expect(await counts(db.pool)).toEqual(before);
    expect((await dana.acquire({ task })).status).toBe(201);
  });
});

describe("owners and projects (IZ-3, IZ-5)", () => {
  it("an agent of another user with the same name and session is never the owner (IZ-5)", async () => {
    const task = newTask();
    expect((await bot1.acquire({ task })).status).toBe(201);
    const before = await counts(db.pool);
    expect((await bot2.acquire({ task })).status).toBe(409);
    expect((await bot2.acquire({ task, steal: true })).status).toBe(409);
    expect((await bot2.heartbeat(task)).status).toBe(409);
    expect((await bot2.release(task)).status).toBe(409);
    expect(await counts(db.pool)).toEqual(before);
    expect((await bot1.release(task)).json).toEqual({ released: true });
  });

  it("the same task ID in two projects never mixes (IZ-3)", async () => {
    const task = newTask();
    // Paths no other claim in this file uses: an overlap can only come from beta.
    expect((await beta.acquire({ task, paths: ["iz3-zone/**"], note: "beta secret plan" })).status).toBe(201);
    const a = await dana.acquire({ task, paths: ["iz3-zone/api/**"] });
    expect(a.status).toBe(201);
    expect(a.json.overlaps).toEqual([]);
    expect(JSON.stringify((await dana.live()).json)).not.toMatch(/beta secret plan/);
    expect((await dana.heartbeat(task)).status).toBe(200);
    expect((await dana.release(task)).json).toEqual({ released: true });
    const b = (await beta.live()).json.claims.find((c: { task: string }) => c.task === `beta:${task}`);
    expect(b).toMatchObject({ holder: "human:rina", note: "beta secret plan" });
    const before = await counts(db.pool);
    const cross = await dana.acquire({ task: `beta:${task}` });
    expect(cross.status).toBe(400);
    expect(await counts(db.pool)).toEqual(before);
  });

  it("reports overlapping paths in the same project as a warning only", async () => {
    const t1 = newTask();
    const t2 = newTask();
    await rina.acquire({ task: t1, paths: ["services/webhooks/**"] });
    const r = await dana.acquire({ task: t2, paths: ["services/webhooks/handler.ts"] });
    expect(r.status).toBe(201);
    expect(r.json.overlaps).toEqual([
      { ref: `alpha:${t1}`, holder: "human:rina", paths: ["services/webhooks/**"] },
    ]);
    expect(r.json.warnings[0]).toMatch(/overlap/);
  });
});

describe("input that is refused changes nothing (KT-2, BR-1)", () => {
  it("bad bodies, sessions and secrets give 400 and no write", async () => {
    const before = await counts(db.pool);
    const task = newTask();
    for (const body of [
      { task, holder: "human:boss" },
      { task: "dec-0a1b2c3d" },
      { task, ttl_minutes: 2000 },
      { task, paths: ["../x"] },
      "not json",
    ]) {
      const r = await dana.acquire(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      checkProblem(r, "USAGE");
    }
    for (let i = 0; i < 20; i++) {
      const t = newToken();
      for (const r of [
        await dana.acquire({ task, note: `use ${t}` }),
        await dana.acquire({ task, paths: [`x/${t}`] }),
      ]) {
        expect(r.status).toBe(400);
        checkProblem(r, "SECRET_DETECTED");
        expect(r.text).not.toContain(t);
      }
      expect((await dana.acquire({ task }, t)).status).toBe(400);
    }
    expect(
      (
        await call(srv.url, {
          method: "POST",
          path: "/v1/projects/alpha/claims",
          token: dana.token,
          body: { task },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(srv.url, {
          method: "PUT",
          path: `/v1/projects/alpha/claims/${task}/heartbeat`,
          token: dana.token,
          session: "s",
          body: { x: 1 },
        })
      ).status,
    ).toBe(400);
    expect(await counts(db.pool)).toEqual(before);
  });
});

describe("races with a barrier, both orders (KL-6)", () => {
  async function race(
    prepare: (task: string) => Promise<void>,
    a: (t: string) => Promise<{ status: number }>,
    b: (t: string) => Promise<{ status: number }>,
  ) {
    const task = newTask();
    await prepare(task);
    const lock = await holdTaskLock(db, taskLockKey(alphaId, `alpha:${task}`));
    const pa = a(task);
    await waitForLockWaiters(db, 1);
    const pb = b(task);
    await waitForLockWaiters(db, 2);
    await lock.release();
    const out = [(await pa).status, (await pb).status];
    await assertInvariants(db.pool);
    return out;
  }
  const stealable = async (task: string) => {
    await bot1.acquire({ task, ttl_minutes: 1 });
    await age(db.pool, `alpha:${task}`, 7);
  };
  it("steal × steal: one wins", async () => {
    for (const order of [0, 1]) {
      const [x, y] = order ? [rina, dana] : [dana, rina];
      const r = await race(
        stealable,
        (t) => x.acquire({ task: t, steal: true }),
        (t) => y.acquire({ task: t, steal: true }),
      );
      expect(r.sort()).toEqual([201, 409]);
    }
  });
  it("steal × heartbeat of the expired owner: the steal wins, the heartbeat never revives", async () => {
    expect(
      await race(
        stealable,
        (t) => rina.acquire({ task: t, steal: true }),
        (t) => bot1.heartbeat(t),
      ),
    ).toEqual([201, 409]);
    expect(
      await race(
        stealable,
        (t) => bot1.heartbeat(t),
        (t) => rina.acquire({ task: t, steal: true }),
      ),
    ).toEqual([409, 201]);
  });
  it("release × acquire: either order is valid, never two open claims", async () => {
    const held = async (task: string) => {
      await dana.acquire({ task });
    };
    expect(
      await race(
        held,
        (t) => dana.release(t),
        (t) => rina.acquire({ task: t }),
      ),
    ).toEqual([200, 201]);
    expect(
      await race(
        held,
        (t) => rina.acquire({ task: t }),
        (t) => dana.release(t),
      ),
    ).toEqual([409, 200]);
  });
});
