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
    } finally {
      await srv.close();
    }
    expect(srv.listening()).toBe(false);
  });
});
