import { hashToken, newToken } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, client, freshDb, newTask, processServer, type TestDb, token } from "./helpers.js";

let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.drop();
});

/** Every value a token could hide in: all text of all tables, except the one hash column that must hold it. */
async function databaseText(): Promise<string> {
  const tables = ["projects", "users", "memberships", "claims", "events", "audit_log", "schema_migrations"];
  const parts = await Promise.all(
    tables.map(async (t) => JSON.stringify((await db.pool.query(`SELECT * FROM ${t}`)).rows)),
  );
  parts.push(
    JSON.stringify(
      (await db.pool.query("SELECT id, project_id, user_id, kind, name, scopes FROM tokens")).rows,
    ),
  );
  return parts.join("\n");
}

describe("tokens never leak (BR-2, non-SSE)", () => {
  it("not in output, answers, logs or tables; the scan itself finds a planted value", async () => {
    const tokens = [
      await token(db.pool, "alpha", "dana"),
      await token(db.pool, "alpha", "rina", { scopes: ["read"] }),
    ];
    const stranger = newToken();
    const proc = await processServer(db);
    const seen: string[] = [];
    try {
      for (const t of [...tokens, stranger]) {
        const c = client(proc.url, "alpha", t, "s1");
        const task = newTask();
        for (const r of [
          await c.live(),
          await c.acquire({ task, note: "hello" }),
          await c.acquire({ task: "dec-0a1b2c3d" }),
          await c.acquire({ task, note: `leak ${t}` }),
          await c.heartbeat(task),
          await c.release(task),
          await call(proc.url, { method: "GET", path: `/v1/projects/alpha/live?token=${t}` }),
          await call(proc.url, { method: "GET", path: "/v1/projects/beta/live", token: t }),
        ])
          seen.push(r.text, JSON.stringify([...r.headers.entries()]));
      }
    } finally {
      await proc.stop();
    }
    const haystacks = [proc.output(), ...seen, await databaseText()];
    const needles = [...tokens, stranger].flatMap((t) => [t, t.slice(6), hashToken(t)]);
    for (const h of haystacks) for (const n of needles) expect(h.includes(n)).toBe(false);
    // Positive control: the same check finds a value that is there.
    const planted = [...haystacks, `x ${tokens[0]} y`];
    expect(planted.some((h) => h.includes(tokens[0] ?? "none"))).toBe(true);
  }, 120_000);
});
