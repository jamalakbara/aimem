import { connect } from "node:net";
import { createToken, newToken, ROUTES, type RunningServer } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertInvariants, call, counts, freshDb, newTask, server, type TestDb, token } from "./helpers.js";

let db: TestDb;
let srv: RunningServer;
const T: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDb();
  srv = await server(db);
  const p = db.pool;
  T.full = await token(p, "alpha", "dana");
  T.readOnly = await token(p, "alpha", "dana", { scopes: ["read"] });
  T.writeOnly = await token(p, "alpha", "dana", { scopes: ["write:live"] });
  T.none = await token(p, "alpha", "dana", { scopes: [] });
  T.admin = await token(p, "alpha", "dana", { scopes: ["admin"] });
  T.expired = await token(p, "alpha", "dana", { expiresAt: new Date(Date.now() - 1000) });
  const revoked = await createToken(p, {
    project: "alpha",
    user: "dana",
    kind: "human",
    scopes: ["read", "write:live"],
  });
  await p.query("UPDATE tokens SET revoked_at = clock_timestamp() WHERE id = $1", [revoked.id]);
  T.revoked = revoked.token;
  // Rina is a member of alpha and beta; this token is for beta only.
  await token(p, "alpha", "rina");
  T.otherProject = await token(p, "beta", "rina");
  T.removed = await token(p, "alpha", "gone");
  await p.query(
    "DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE handle = 'gone') AND project_id = (SELECT id FROM projects WHERE slug = 'alpha')",
  );
});
afterAll(async () => {
  await srv.close();
  await db.drop();
});

/** A request by a caller that is refused before the resource is looked at. */
function attempt(route: (typeof ROUTES)[number], tok: string | undefined, authHeader?: string) {
  const task = newTask();
  return call(srv.url, {
    method: route.method,
    path: route.path("alpha", task),
    ...(tok !== undefined ? { token: tok } : {}),
    ...(authHeader !== undefined ? { headers: { Authorization: authHeader } } : {}),
    session: "s-m",
    ...(route.name === "acquire" ? { body: { task } } : {}),
  });
}

describe("permission matrix (IZ-1, plan §6.4)", () => {
  const expectFor = (route: (typeof ROUTES)[number], scopes: string[]) =>
    scopes.includes(route.scope) ? "allowed" : "403";

  it("every route answers each kind of caller as the table says, in the fixed order", async () => {
    expect(ROUTES.map((r) => r.name)).toEqual(["live", "acquire", "heartbeat", "release"]);
    for (const route of ROUTES) {
      const before = await counts(db.pool);
      for (const [name, tok, header] of [
        ["no token", undefined, undefined],
        ["Basic scheme", undefined, `Basic ${Buffer.from("a:b").toString("base64")}`],
        ["malformed", undefined, "Bearer abc"],
        ["lower-case scheme", undefined, `bearer ${T.full}`],
        ["unknown", newToken(), undefined],
        ["revoked", T.revoked, undefined],
        ["expired", T.expired, undefined],
      ] as const) {
        const r = await attempt(route, tok, header);
        expect(r.status, `${route.name} ${name}`).toBe(401);
        expect(r.json.code).toBe("UNAUTHENTICATED");
        expect(r.headers.get("www-authenticate")).toBe('Bearer realm="aimem"');
      }
      for (const [name, tok] of [
        ["other project", T.otherProject],
        ["membership removed", T.removed],
      ] as const) {
        const r = await attempt(route, tok);
        expect(r.status, `${route.name} ${name}`).toBe(404);
        expect(r.json.code).toBe("NOT_FOUND");
      }
      // Heartbeat and release of someone else's claim are conflicts; their own claims need their own token.
      for (const [name, tok, scopes] of [
        ["no scope", T.none, []],
        ["admin only", T.admin, ["admin"]],
        ["read only", T.readOnly, ["read"]],
        ["write:live only", T.writeOnly, ["write:live"]],
      ] as const) {
        const task = newTask();
        if (
          route.name !== "live" &&
          route.name !== "acquire" &&
          expectFor(route, [...scopes]) === "allowed"
        ) {
          // The same user (dana) holds the claim with the same session, so it is "theirs".
          expect(
            (
              await call(srv.url, {
                method: "POST",
                path: "/v1/projects/alpha/claims",
                token: T.full,
                session: "s-own",
                body: { task },
              })
            ).status,
          ).toBe(201);
        }
        const r = await call(srv.url, {
          method: route.method,
          path: route.path("alpha", task),
          token: tok,
          session: "s-own",
          ...(route.name === "acquire" ? { body: { task } } : {}),
        });
        if (expectFor(route, [...scopes]) === "403") {
          expect(r.status, `${route.name} ${name}`).toBe(403);
          expect(r.json.code).toBe("PERMISSION_DENIED");
        } else expect(r.status, `${route.name} ${name}`).toBeLessThan(300);
      }
      void before;
    }
    await assertInvariants(db.pool);
  });

  it("two mistakes give the earlier answer: 401, then 404, then 403, then 400", async () => {
    const acquire = (tok: string | undefined, slug: string, body: unknown) =>
      call(srv.url, {
        method: "POST",
        path: `/v1/projects/${slug}/claims`,
        ...(tok ? { token: tok } : {}),
        session: "s1",
        body,
      });
    const before = await counts(db.pool);
    expect((await acquire(undefined, "beta", { bad: 1 })).status).toBe(401);
    expect((await acquire(T.revoked, "nope", "{")).status).toBe(401);
    expect((await acquire(T.full, "beta", { bad: 1 })).status).toBe(404);
    expect((await acquire(T.readOnly, "alpha", { bad: 1 })).status).toBe(403);
    expect((await acquire(T.readOnly, "beta", { bad: 1 })).status).toBe(404);
    expect((await acquire(T.full, "alpha", { bad: 1 })).status).toBe(400);
    const big = { task: newTask(), note: "x".repeat(20_000) };
    expect((await acquire(T.readOnly, "alpha", big)).status).toBe(403);
    expect((await acquire(T.full, "alpha", big)).status).toBe(413);
    expect(await counts(db.pool)).toEqual(before);
  });

  it("another project and a missing project look exactly the same (IZ-2)", async () => {
    for (const body of [{ task: newTask() }, "{", { holder: "human:x" }]) {
      const a = await call(srv.url, {
        method: "POST",
        path: "/v1/projects/beta/claims",
        token: T.full,
        session: "s1",
        body,
      });
      const b = await call(srv.url, {
        method: "POST",
        path: "/v1/projects/nope/claims",
        token: T.full,
        session: "s1",
        body,
      });
      expect(a.status).toBe(404);
      expect(b.status).toBe(a.status);
      expect(b.text).toBe(a.text);
      const strip = (h: Headers) => [...h.entries()].filter(([k]) => k !== "date");
      expect(strip(b.headers)).toEqual(strip(a.headers));
    }
    for (const r of ROUTES) {
      const a = await call(srv.url, { method: r.method, path: r.path("beta"), token: T.full, session: "s1" });
      const b = await call(srv.url, { method: r.method, path: r.path("nope"), token: T.full, session: "s1" });
      expect([a.status, a.text]).toEqual([404, b.text]);
    }
  });

  it("a token only counts in one Authorization header, never in the address", async () => {
    const live = "/v1/projects/alpha/live";
    expect((await call(srv.url, { method: "GET", path: `${live}?access_token=${T.full}` })).status).toBe(401);
    expect((await call(srv.url, { method: "GET", path: `${live}?x=${T.full}`, token: T.full })).status).toBe(
      401,
    );
    const raw = (headers: string) =>
      new Promise<string>((done) => {
        const s = connect(srv.port, "127.0.0.1", () =>
          s.write(`GET ${live} HTTP/1.1\r\nHost: x\r\n${headers}Connection: close\r\n\r\n`),
        );
        let out = "";
        s.on("data", (d) => {
          out += d;
        });
        s.on("close", () => done(out));
      });
    expect(await raw(`Authorization: Bearer ${T.full}\r\n`)).toMatch(/^HTTP\/1\.1 200/);
    expect(await raw(`Authorization: Bearer ${T.full}\r\nAuthorization: Bearer ${T.full}\r\n`)).toMatch(
      /^HTTP\/1\.1 401/,
    );
    expect(await raw(`Authorization: Bearer ${T.full} x\r\n`)).toMatch(/^HTTP\/1\.1 401/);
  });

  it("records when a token was last used", async () => {
    const before = await db.pool.query("SELECT max(last_used_at) AS t FROM tokens");
    await call(srv.url, { method: "GET", path: "/v1/projects/alpha/live", token: T.readOnly });
    await new Promise((d) => setTimeout(d, 200));
    const after = await db.pool.query("SELECT max(last_used_at) AS t FROM tokens");
    expect(after.rows[0].t?.getTime() ?? 0).toBeGreaterThan(before.rows[0].t?.getTime() ?? 0);
  });
});
