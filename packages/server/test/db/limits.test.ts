import { MAX_BODY_BYTES, type RunningServer, startServer } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, client, counts, freshDb, newTask, server, type TestDb, token } from "./helpers.js";

let db: TestDb;
let srv: RunningServer;
let tok: string;
beforeAll(async () => {
  db = await freshDb();
  srv = await server(db);
  tok = await token(db.pool, "alpha", "dana");
});
afterAll(async () => {
  await srv.close();
  await db.drop();
});

describe("server limits (plan A12, §6.4)", () => {
  it("refuses a body over 16 KB with 413 and writes nothing", async () => {
    const before = await counts(db.pool);
    const r = await call(srv.url, {
      method: "POST",
      path: "/v1/projects/alpha/claims",
      token: tok,
      session: "s",
      body: JSON.stringify({ task: newTask(), note: "x".repeat(MAX_BODY_BYTES) }),
    });
    expect(r.status).toBe(413);
    expect(r.json.code).toBe("USAGE");
    expect(await counts(db.pool)).toEqual(before);
  });

  it("answers 404 for routes the server does not have, and healthz without details", async () => {
    // GET /events is a route since 6.1b (a stream that stays open), so only addresses that do not exist here.
    for (const [method, path] of [
      ["GET", "/v1/projects/alpha/events/extra"],
      ["POST", "/v1/projects/alpha/events"],
      ["GET", "/v1/projects/alpha/claims"],
      ["POST", "/v1/projects/alpha/live"],
      ["GET", "/"],
      ["PATCH", "/v1/projects/alpha/claims/tsk-00000000"],
    ] as const)
      expect((await call(srv.url, { method, path, token: tok })).status, `${method} ${path}`).toBe(404);
    const h = await call(srv.url, { method: "GET", path: "/healthz" });
    expect([h.status, h.json]).toEqual([200, { ok: true }]);
  });

  it("answers 503 SYNC_FAILED when the database is unreachable", async () => {
    const down = await startServer({ databaseUrl: "postgres://x:y@127.0.0.1:1/none", poolMax: 1 });
    try {
      const r = await client(down.url, "alpha", tok).live();
      expect(r.status).toBe(503);
      expect(r.json.code).toBe("SYNC_FAILED");
      expect(r.headers.get("retry-after")).toBe("1");
      expect(r.text).not.toMatch(/127\.0\.0\.1|none|postgres/);
      const h = await call(down.url, { method: "GET", path: "/healthz" });
      expect([h.status, h.json]).toEqual([503, { ok: false }]);
    } finally {
      await down.close();
    }
  });
});
