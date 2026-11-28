import { createServer } from "node:net";
import { newToken, startServer } from "@aimem/server";
import { describe, expect, it } from "vitest";
import { call } from "../db/helpers.js";

/** A port with nothing listening, so every database connection is refused at once. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((d) => s.listen(0, "127.0.0.1", d));
  const port = (s.address() as { port: number }).port;
  await new Promise((d) => s.close(d));
  return port;
}

/**
 * The wiring of `GET /events` with the database away, which can run without PostgreSQL: the server starts, its
 * LISTEN connection keeps retrying in the background, requests get 503 instead of a crash, and close() returns.
 */
describe("events route without a database (local)", () => {
  it("starts, answers 503 SYNC_FAILED, routes only GET, and closes cleanly", async () => {
    const port = await closedPort();
    const srv = await startServer({
      databaseUrl: `postgres://nobody:nothing@127.0.0.1:${port}/none`,
      listen: { reconnectMinMs: 20, reconnectMaxMs: 40, pollMs: 20 },
      // The timer sweeper also runs and fails quietly against the missing database.
      sweepMs: 20,
    });
    try {
      expect(srv.listening()).toBe(false);
      const r = await call(srv.url, {
        method: "GET",
        path: "/v1/projects/alpha/events?since=0",
        token: newToken(),
      });
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ code: "SYNC_FAILED" });
      expect(r.headers.get("retry-after")).toBe("1");
      expect(r.text).not.toContain(String(port));
      for (const method of ["POST", "PUT", "DELETE"])
        expect((await call(srv.url, { method, path: "/v1/projects/alpha/events" })).status, method).toBe(404);
      expect((await call(srv.url, { method: "GET", path: "/v1/projects/alpha/events" })).status).toBe(401);
      expect(
        (await call(srv.url, { method: "GET", path: `/v1/projects/alpha/events?since=${newToken()}` }))
          .status,
      ).toBe(401);
      // Reconnect attempts keep failing in the background without taking the server down.
      await new Promise((d) => setTimeout(d, 200));
      expect((await call(srv.url, { method: "GET", path: "/healthz" })).status).toBe(503);
      expect(srv.streams()).toBe(0);
      // A sweeper run fails while the database is away; the server keeps answering.
      await expect(srv.sweep()).rejects.toBeDefined();
      expect((await call(srv.url, { method: "GET", path: "/healthz" })).status).toBe(503);
    } finally {
      await srv.close();
    }
    expect(srv.listening()).toBe(false);
  });
});

describe("Aimem-Instance header for the p95 measurement (plan §8)", () => {
  it("names the instance on every answer, and ignores a name that is not plain", async () => {
    const port = await closedPort();
    const named = await startServer({
      databaseUrl: `postgres://x:y@127.0.0.1:${port}/none`,
      instance: "i2",
      sweepMs: false,
    });
    const odd = await startServer({
      databaseUrl: `postgres://x:y@127.0.0.1:${port}/none`,
      instance: "i2\r\nX-Other: 1",
      sweepMs: false,
    });
    try {
      for (const path of ["/healthz", "/v1/projects/alpha/events", "/nowhere"])
        expect((await call(named.url, { method: "GET", path })).headers.get("aimem-instance"), path).toBe(
          "i2",
        );
      const r = await call(odd.url, { method: "GET", path: "/healthz" });
      expect(r.headers.get("aimem-instance")).toBeNull();
      expect(r.headers.get("x-other")).toBeNull();
    } finally {
      await named.close();
      await odd.close();
    }
  });
});
