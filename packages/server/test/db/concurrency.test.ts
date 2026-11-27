import { taskLockKey } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertInvariants,
  client,
  freshDb,
  holdTaskLock,
  newTask,
  processServer,
  secondServer,
  server,
  type TestDb,
  token,
  waitForLockWaiters,
} from "./helpers.js";

let db: TestDb;
let alphaId: string;
const tokens: string[] = [];

beforeAll(async () => {
  db = await freshDb();
  for (let i = 0; i < 50; i++)
    tokens.push(await token(db.pool, "alpha", `user${i}`, i % 2 ? { kind: "agent", name: "bot" } : {}));
  alphaId = (await db.pool.query("SELECT id FROM projects WHERE slug = 'alpha'")).rows[0].id;
});
afterAll(async () => {
  await assertInvariants(db.pool);
  await db.drop();
});

async function contest(urls: string[], rounds: number, callers = 50) {
  for (let round = 0; round < rounds; round++) {
    const task = newTask();
    const replies = await Promise.all(
      tokens
        .slice(0, callers)
        .map((t, i) => client(urls[i % urls.length] ?? "", "alpha", t, `s-${i}`).acquire({ task })),
    );
    const won = replies.filter((r) => r.status === 201);
    const lost = replies.filter((r) => r.status === 409);
    expect(won, `round ${round}`).toHaveLength(1);
    expect(lost, `round ${round}`).toHaveLength(callers - 1);
    const winner = won[0]?.json.claim;
    for (const r of lost) {
      expect(r.json.code).toBe("CLAIM_CONFLICT");
      expect(r.json.details).toEqual({ holder: winner.holder, since: winner.started });
    }
    const rows = await db.pool.query(
      `SELECT (SELECT count(*) FROM claims WHERE task_ref = $1 AND released_at IS NULL)::int AS open,
              (SELECT count(*) FROM events WHERE payload->'claim'->>'task' = $1)::int AS events,
              (SELECT count(*) FROM audit_log WHERE target = $1)::int AS audit`,
      [`alpha:${task}`],
    );
    expect(rows.rows[0]).toEqual({ open: 1, events: 1, audit: 1 });
  }
}

describe("exactly one winner (KL-1, KL-2, KL-3)", () => {
  it("two server processes, one database, 50 callers × 200 rounds (KL-1)", async () => {
    const a = await processServer(db);
    const b = await processServer(db);
    try {
      await contest([a.url, b.url], 200);
    } finally {
      await a.stop();
      await b.stop();
    }
  }, 600_000);

  it("the unique index alone refuses a second open claim, and the server answers 409 (KL-2)", async () => {
    const task = `alpha:${newTask()}`;
    const user = (await db.pool.query("SELECT id FROM users LIMIT 1")).rows[0].id;
    const row = `INSERT INTO claims (project_id, task_ref, owner_user_id, holder, session, started_at, heartbeat_at, ttl_minutes, expires_at)
                 VALUES ($1, $2, $3, $4, 's', clock_timestamp(), clock_timestamp(), 60, clock_timestamp() + interval '1 hour')`;
    await db.pool.query(row, [alphaId, task, user, "human:early"]);
    await expect(db.pool.query(row, [alphaId, task, user, "human:late"])).rejects.toMatchObject({
      code: "23505",
    });
    // Through the server: a row appears after the server read "no claim" under its lock.
    const id = newTask();
    let injected = false;
    const srv = await server(db, {
      at: async (point, info) => {
        if (point === "read" && info.task === `alpha:${id}` && !injected) {
          injected = true;
          await db.pool.query(row, [alphaId, `alpha:${id}`, user, "human:sneaky"]);
        }
      },
    });
    try {
      const r = await client(srv.url, "alpha", tokens[0] ?? "").acquire({ task: id });
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ code: "CLAIM_CONFLICT", details: { holder: "human:sneaky" } });
    } finally {
      await srv.close();
    }
    await db.pool.query(
      "UPDATE claims SET released_at = clock_timestamp(), released_status = 'released' WHERE holder IN ('human:early', 'human:sneaky')",
    );
  });

  it("requests really wait on the task lock, and the lock alone gives one winner (KL-3)", async () => {
    const s1 = await server(db);
    const s2 = await secondServer(db);
    try {
      const task = newTask();
      const lock = await holdTaskLock(db, taskLockKey(alphaId, `alpha:${task}`));
      const a = client(s1.url, "alpha", tokens[2] ?? "", "a").acquire({ task });
      const b = client(s2.url, "alpha", tokens[3] ?? "", "b").acquire({ task });
      await waitForLockWaiters(db, 2);
      await lock.release();
      expect([(await a).status, (await b).status].sort()).toEqual([201, 409]);
      // Without the unique index, the lock still holds.
      await db.pool.query("DROP INDEX claims_one_open");
      try {
        await contest([s1.url, s2.url], 20);
      } finally {
        await db.pool.query(
          "CREATE UNIQUE INDEX claims_one_open ON claims (project_id, task_ref) WHERE released_at IS NULL",
        );
      }
    } finally {
      await s1.close();
      await s2.close();
    }
  }, 300_000);
});
