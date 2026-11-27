import { connect } from "node:net";
import { createToken, newToken, ROUTES, type RunningServer } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertInvariants,
  call,
  counts,
  freshDb,
  newTask,
  server,
  state,
  type TestDb,
  token,
} from "./helpers.js";

let db: TestDb;
let srv: RunningServer;
const T: Record<string, string> = {};
const goneTasks: string[] = [];

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
  T.rinaAlpha = await token(p, "alpha", "rina");
  T.otherProject = await token(p, "beta", "rina");
  T.removed = await token(p, "alpha", "gone");
  // Claims that the removed member still owns, so that a request that slipped through would change them.
  for (let i = 0; i < 4; i++) {
    const task = newTask();
    const r = await call(srv.url, {
      method: "POST",
      path: "/v1/projects/alpha/claims",
      token: T.removed,
      session: "s-m",
      body: { task },
    });
    expect(r.status).toBe(201);
    goneTasks.push(task);
  }
  await p.query(
    "DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE handle = 'gone') AND project_id = (SELECT id FROM projects WHERE slug = 'alpha')",
  );
});
afterAll(async () => {
  await srv.close();
  await db.drop();
});

type Route = (typeof ROUTES)[number];

/**
 * The target of a refused request: for heartbeat and release, an existing claim that belongs to the identity the
 * token would have if a check were skipped, so a skipped check would change it; for acquire, a free task.
 */
async function target(route: Route, owner: string | undefined): Promise<string> {
  if (route.name === "heartbeat" || route.name === "release") {
    if (owner === "gone") {
      const task = goneTasks.shift();
      if (!task) throw new Error("no claim of the removed member left");
      return task;
    }
    const task = newTask();
    const r = await call(srv.url, {
      method: "POST",
      path: "/v1/projects/alpha/claims",
      token: owner ?? T.full,
      session: "s-m",
      body: { task },
    });
    expect(r.status).toBe(201);
    return task;
  }
  return newTask();
}

/** A refused request, with the full stored state compared before and after it (QA #121, IZ-1). */
async function refused(
  route: Route,
  o: { token?: string; header?: string; owner?: string },
  status: number,
  code: string,
  label: string,
) {
  const task = await target(route, o.owner);
  // Later than the claim's own heartbeat, so a heartbeat that slipped through would change the row.
  await new Promise((d) => setTimeout(d, 3));
  const before = await state(db.pool);
  const r = await call(srv.url, {
    method: route.method,
    path: route.path("alpha", task),
    ...(o.token !== undefined ? { token: o.token } : {}),
    ...(o.header !== undefined ? { headers: { Authorization: o.header } } : {}),
    session: "s-m",
    ...(route.name === "acquire" ? { body: { task } } : {}),
  });
  expect(r.status, label).toBe(status);
  expect(r.json.code, label).toBe(code);
  if (status === 401) expect(r.headers.get("www-authenticate"), label).toBe('Bearer realm="aimem"');
  expect(await state(db.pool), `${label}: stored state changed`).toBe(before);
}

describe("permission matrix (IZ-1, plan §6.4)", () => {
  it("every refusal leaves the stored state as it was, also next to existing claims", async () => {
    expect(ROUTES.map((r) => r.name)).toEqual(["live", "acquire", "heartbeat", "release"]);
    for (const route of ROUTES) {
      const at = (name: string) => `${route.name} ${name}`;
      // 401: the identity in brackets is the one the token would have, so its own claim is the target.
      await refused(route, {}, 401, "UNAUTHENTICATED", at("no token"));
      await refused(
        route,
        { header: `Basic ${Buffer.from("a:b").toString("base64")}` },
        401,
        "UNAUTHENTICATED",
        at("Basic scheme"),
      );
      await refused(route, { header: "Bearer abc" }, 401, "UNAUTHENTICATED", at("malformed"));
      await refused(
        route,
        { header: `bearer ${T.full}`, owner: T.full },
        401,
        "UNAUTHENTICATED",
        at("lower-case scheme"),
      );
      await refused(route, { token: newToken() }, 401, "UNAUTHENTICATED", at("unknown"));
      await refused(route, { token: T.revoked, owner: T.full }, 401, "UNAUTHENTICATED", at("revoked (dana)"));
      await refused(route, { token: T.expired, owner: T.full }, 401, "UNAUTHENTICATED", at("expired (dana)"));
      // 404: rina's beta token against her own alpha claim; the removed member against claims it still owns.
      await refused(
        route,
        { token: T.otherProject, owner: T.rinaAlpha },
        404,
        "NOT_FOUND",
        at("other project (rina)"),
      );
      await refused(
        route,
        { token: T.removed, owner: "gone" },
        404,
        "NOT_FOUND",
        at("membership removed (gone)"),
      );
      // 403: dana's tokens without the scope, against dana's own claim.
      for (const [name, tok, scopes] of [
        ["no scope", T.none, []],
        ["admin only", T.admin, ["admin"]],
        ["read only", T.readOnly, ["read"]],
        ["write:live only", T.writeOnly, ["write:live"]],
      ] as const)
        if (!(scopes as readonly string[]).includes(route.scope))
          await refused(route, { token: tok, owner: T.full }, 403, "PERMISSION_DENIED", at(name));
    }
    await assertInvariants(db.pool);
  });

  it("an allowed scope does reach the claim (the same targets, so the refusals above are meaningful)", async () => {
    for (const route of ROUTES)
      for (const [name, tok, scopes] of [
        ["read only", T.readOnly, ["read"]],
        ["write:live only", T.writeOnly, ["write:live"]],
        ["both", T.full, ["read", "write:live"]],
      ] as const) {
        if (!(scopes as readonly string[]).includes(route.scope)) continue;
        const task = await target(route, T.full);
        await new Promise((d) => setTimeout(d, 3));
        const before = await state(db.pool);
        const r = await call(srv.url, {
          method: route.method,
          path: route.path("alpha", task),
          token: tok,
          session: "s-m",
          ...(route.name === "acquire" ? { body: { task } } : {}),
        });
        expect(r.status, `${route.name} ${name}`).toBe(route.name === "acquire" ? 201 : 200);
        if (route.name !== "live") expect(await state(db.pool), `${route.name} ${name}`).not.toBe(before);
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
