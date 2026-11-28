import { readClaim } from "@aimem/core";
import { hashToken, type RunningServer, startServer } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStream, type SseEvent, type SseStream } from "../sse-client.js";
import {
  age,
  assertInvariants,
  client,
  freshDb,
  newTask,
  secondServer,
  sleep,
  type TestDb,
  token,
} from "./helpers.js";

/**
 * 6.1b, first part: one client takes a task, another one sees it through `GET /events` (SSE). PostgreSQL only,
 * in the CI job `server` (plan §7.2). IDs from qa-review.md: EV-1–EV-9, IZ-4, IZ-6, KT-1 (event payload), BR-2 (SSE).
 */
let db: TestDb;
let srv1: RunningServer;
let srv2: RunningServer;
const T: Record<string, string> = {};
// biome-ignore lint/suspicious/noExplicitAny: test clients
let dana: any, rina: any, dana2: any, bob: any;
let holdAtSeq: { task: string; reached: () => void; go: Promise<void> } | undefined;
let atBacklog: (() => Promise<void>) | undefined;
const streams: SseStream[] = [];

const events = (
  base: string,
  slug = "alpha",
  o: { token?: string; since?: string; lastEventId?: string } = {},
) =>
  openStream(base, `/v1/projects/${slug}/events${o.since !== undefined ? `?since=${o.since}` : ""}`, {
    token: o.token ?? T.viewer,
    ...(o.lastEventId !== undefined ? { lastEventId: o.lastEventId } : {}),
  }).then((s) => {
    streams.push(s);
    return s;
  });
const lastSeq = async (slug = "alpha") =>
  Number(
    (
      await db.pool.query(
        "SELECT last_seq FROM project_event_seq p JOIN projects j ON j.id = p.project_id WHERE j.slug = $1",
        [slug],
      )
    ).rows[0].last_seq,
  );
const tableSeqs = async (slug = "alpha") =>
  (
    await db.pool.query(
      "SELECT seq FROM events e JOIN projects p ON p.id = e.project_id WHERE p.slug = $1 ORDER BY seq",
      [slug],
    )
  ).rows.map((r) => Number(r.seq));
const ids = (list: SseEvent[]) => list.map((e) => Number(e.id));
const forTask = (task: string) => (list: SseEvent[]) =>
  list.some((e) => e.data.claim?.task === `alpha:${task}`);
/** Resolves true when the server ended the stream within `ms`; a missing check then fails fast, not by timeout. */
const endedWithin = (s: SseStream, ms: number) =>
  Promise.race([s.ended.then(() => true), sleep(ms).then(() => false)]);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

beforeAll(async () => {
  db = await freshDb();
  srv1 = await startServer({
    sweepMs: false,
    pool: db.pool,
    hooks: {
      at: async (point, info) => {
        if (point === "seq" && holdAtSeq && info.task === holdAtSeq.task) {
          holdAtSeq.reached();
          await holdAtSeq.go;
        }
      },
      stream: async (point) => {
        if (point === "backlog" && atBacklog) {
          const run = atBacklog;
          atBacklog = undefined;
          await run();
        }
      },
    },
  });
  srv2 = await secondServer(db);
  T.dana = await token(db.pool, "alpha", "dana");
  T.rina = await token(db.pool, "alpha", "rina");
  T.viewer = await token(db.pool, "alpha", "vera", { scopes: ["read"] });
  T.bob = await token(db.pool, "beta", "bob");
  T.bobAlpha = await token(db.pool, "alpha", "bob", { scopes: ["read"] });
  dana = client(srv1.url, "alpha", T.dana, "s-dana");
  dana2 = client(srv2.url, "alpha", T.dana, "s-dana");
  rina = client(srv2.url, "alpha", T.rina, "s-rina");
  bob = client(srv1.url, "beta", T.bob, "s-bob");
});
afterAll(async () => {
  for (const s of streams) s.close();
  await assertInvariants(db.pool);
  await srv1.close();
  await srv2.close();
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
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
/** KT-1 for an event: the SSE fields match the payload, its keys are exact, and core reads its claim. */
function checkEvent(e: SseEvent, type: string) {
  expect(e.event).toBe(type);
  expect(e.id).toBe(String(e.data.seq));
  expect(e.data.type).toBe(type);
  const keys = Object.keys(e.data).sort();
  expect(keys).toEqual(
    type === "claim.taken_over"
      ? ["at", "claim", "previous_holder", "seq", "type"]
      : ["at", "claim", "seq", "type"],
  );
  expect(e.data.at).toMatch(TIME);
  const claim = e.data.claim as Record<string, unknown>;
  expect(Object.keys(claim).every((k) => KEYS.includes(k))).toBe(true);
  const { expired, expiresAt, ...rest } = claim;
  const id = String(claim.task).split(":")[1] ?? "";
  expect(readClaim(JSON.stringify(rest), { id, task: String(claim.task) })).toEqual(rest);
  expect(expiresAt).toBe(
    new Date(Date.parse(String(claim.heartbeat)) + Number(claim.ttl_minutes) * 60_000).toISOString(),
  );
  expect(typeof expired).toBe("boolean");
  for (const k of ["started", "heartbeat", "expiresAt"]) expect(String(claim[k])).toMatch(TIME);
}

describe("one client takes a task, the other sees it (EV-1 over SSE, KT-1)", () => {
  it("delivers created, heartbeat and released in order, across two instances, without polling", async () => {
    const b = await events(srv2.url);
    expect(b.status).toBe(200);
    expect(b.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(b.headers["cache-control"]).toBe("no-store");
    expect(b.headers["x-accel-buffering"]).toBe("no");
    const start = await lastSeq();
    const task = newTask();
    const t0 = Date.now();
    const a = await dana.acquire({ task, paths: ["src/a/**"], note: "from A" });
    expect(a.status).toBe(201);
    // The ping is 15 s and LISTEN is up: arriving this fast means the notification woke the stream.
    await b.waitFor(forTask(task), 2_000, "claim.created");
    expect(Date.now() - t0).toBeLessThan(2_000);
    const created = b.events.find((e) => e.data.claim?.task === `alpha:${task}`) as SseEvent;
    checkEvent(created, "claim.created");
    expect(created.data.claim).toEqual(a.json.claim);
    await sleep(5);
    expect((await dana.heartbeat(task)).status).toBe(200);
    expect((await dana.release(task)).status).toBe(200);
    await b.waitForCount(3);
    expect(b.events.map((e) => e.event)).toEqual(["claim.created", "claim.heartbeat", "claim.released"]);
    expect(ids(b.events)).toEqual(range(start + 1, start + 3));
    checkEvent(b.events[1] as SseEvent, "claim.heartbeat");
    checkEvent(b.events[2] as SseEvent, "claim.released");
    b.close();
  });

  it("a takeover carries the previous holder", async () => {
    const task = newTask();
    expect((await dana.acquire({ task, ttl_minutes: 1 })).status).toBe(201);
    await age(db.pool, `alpha:${task}`, 10);
    const s = await events(srv1.url);
    const r = await rina.acquire({ task, steal: true });
    expect(r.status).toBe(201);
    const [e] = await s.waitForCount(1);
    checkEvent(e as SseEvent, "claim.taken_over");
    expect(e?.data.previous_holder).toBe("human:dana");
    expect(e?.data.claim.holder).toBe("human:rina");
    s.close();
  });
});

describe("cursor (plan §5, EV-3, EV-6, EV-7)", () => {
  it("since = the cursor of GET live gives exactly the changes after that answer (EV-3)", async () => {
    const live = await dana.live();
    const cursor = live.json.cursor as number;
    const task = newTask();
    expect((await rina.acquire({ task })).status).toBe(201);
    const s = await events(srv1.url, "alpha", { since: String(cursor) });
    await s.waitFor(forTask(task));
    expect(ids(s.events)[0]).toBe(cursor + 1);
    expect(ids(s.events).every((n) => n > cursor)).toBe(true);
    s.close();
  });

  it("refuses a bad or future cursor with 400 before any stream starts; Last-Event-ID wins over since", async () => {
    const top = await lastSeq();
    for (const since of ["-1", "abc", "1.5", "01", String(top + 1)]) {
      const s = await events(srv1.url, "alpha", { since });
      expect(s.status, since).toBe(400);
      expect(s.headers["content-type"]).toBe("application/problem+json");
      expect(s.problem).toMatchObject({ status: 400, code: "USAGE" });
    }
    const bad = await events(srv1.url, "alpha", { lastEventId: "x", since: "0" });
    expect(bad.status).toBe(400);
    const s = await events(srv1.url, "alpha", { since: "0", lastEventId: String(top - 1) });
    await s.waitForCount(1);
    await sleep(100);
    expect(ids(s.events)).toEqual([top]);
    s.close();
  });

  it("without a cursor only new events come", async () => {
    const s = await events(srv1.url);
    await sleep(200);
    expect(s.events).toEqual([]);
    const task = newTask();
    await dana.acquire({ task });
    await s.waitFor(forTask(task));
    expect(s.events).toHaveLength(1);
    s.close();
  });

  it("compares cursors as numbers: 9 → 10 → 11 (EV-7)", async () => {
    const g = client(srv1.url, "gamma", await token(db.pool, "gamma", "gil"), "s-g");
    const reader = await token(db.pool, "gamma", "gil", { scopes: ["read"] });
    for (let i = 0; i < 11; i++) expect((await g.acquire({ task: newTask() })).status).toBe(201);
    const s = await openStream(srv1.url, "/v1/projects/gamma/events?since=9", { token: reader });
    streams.push(s);
    await s.waitForCount(2);
    await sleep(100);
    expect(ids(s.events)).toEqual([10, 11]);
    s.close();
    const t = await openStream(srv1.url, "/v1/projects/gamma/events", { token: reader, lastEventId: "10" });
    streams.push(t);
    await t.waitForCount(1);
    expect(ids(t.events)).toEqual([11]);
    t.close();
  });

  it("an instance that went away: the client resumes on another one with Last-Event-ID (EV-6)", async () => {
    const srv3 = await secondServer(db);
    const s = await events(srv3.url, "alpha");
    const first = newTask();
    await dana.acquire({ task: first });
    await s.waitFor(forTask(first));
    const last = s.lastId() as string;
    await srv3.close();
    await s.ended;
    const missed = [newTask(), newTask(), newTask()];
    for (const t of missed) expect((await rina.acquire({ task: t })).status).toBe(201);
    const srv4 = await secondServer(db);
    try {
      // The old since=0 in the address loses to the header, as a browser EventSource would send them.
      const again = await events(srv4.url, "alpha", { since: "0", lastEventId: last });
      await again.waitForCount(3);
      await sleep(100);
      expect(ids(again.events)).toEqual(range(Number(last) + 1, Number(last) + 3));
      expect(again.events.map((e) => e.data.claim.task)).toEqual(missed.map((t) => `alpha:${t}`));
      again.close();
    } finally {
      await srv4.close();
    }
  });
});

describe("order without gaps or repeats (EV-1, EV-2, EV-4)", () => {
  it("a later commit is not sent before an earlier one, also to a client that reconnects in between (EV-1)", async () => {
    const x = newTask();
    const y = newTask();
    const before = await lastSeq();
    const s = await events(srv2.url);
    let reached!: () => void;
    const atSeq = new Promise<void>((d) => {
      reached = d;
    });
    let go!: () => void;
    holdAtSeq = {
      task: `alpha:${x}`,
      reached,
      go: new Promise<void>((d) => {
        go = d;
      }),
    };
    const px = dana.acquire({ task: x });
    await atSeq;
    const py = rina.acquire({ task: y });
    await sleep(500);
    expect(s.events).toEqual([]);
    s.close();
    const again = await events(srv1.url, "alpha", { since: String(before) });
    await sleep(300);
    expect(again.events).toEqual([]);
    go();
    holdAtSeq = undefined;
    expect([(await px).status, (await py).status]).toEqual([201, 201]);
    await again.waitForCount(2);
    expect(again.events.map((e) => [Number(e.id), e.data.claim.task])).toEqual([
      [before + 1, `alpha:${x}`],
      [before + 2, `alpha:${y}`],
    ]);
    again.close();
  });

  it("a commit between the backlog read and the live part arrives exactly once (EV-4)", async () => {
    const task = newTask();
    const before = await lastSeq();
    atBacklog = async () => {
      expect((await rina.acquire({ task })).status).toBe(201);
    };
    const s = await events(srv1.url, "alpha", { since: String(before) });
    await s.waitFor(forTask(task));
    await sleep(300);
    expect(ids(s.events)).toEqual([before + 1]);
    s.close();
  });

  it("200 parallel claims on two instances, a client that keeps reconnecting: every event once, in order (EV-2)", async () => {
    const start = await lastSeq();
    const writers = [dana, dana2, rina];
    const writes = Promise.all(
      Array.from({ length: 200 }, (_, i) => (writers[i % 3] as typeof dana).acquire({ task: newTask() })),
    );
    let done = false;
    void writes.then(() => {
      done = true;
    });
    const got: SseEvent[] = [];
    let cursor = String(start);
    let round = 0;
    while (!done || Number(cursor) < (await lastSeq())) {
      const s = await events(round++ % 2 ? srv1.url : srv2.url, "alpha", { lastEventId: cursor });
      expect(s.status).toBe(200);
      await s.waitFor((e) => e.length >= 15, 300, "a few events").catch(() => undefined);
      s.close();
      await s.ended;
      got.push(...s.events);
      cursor = s.lastId() ?? cursor;
    }
    const replies = await writes;
    expect(replies.every((r) => r.status === 201)).toBe(true);
    const end = await lastSeq();
    expect(round).toBeGreaterThan(2);
    expect(ids(got)).toEqual(range(start + 1, end));
    expect((await tableSeqs()).filter((n) => n > start)).toEqual(range(start + 1, end));
  });
});

describe("the LISTEN connection is cut (EV-5)", () => {
  it("an event committed right after the cut still arrives within 3 s, and LISTEN comes back", async () => {
    const s = await events(srv1.url);
    const cut = await db.pool.query(
      "SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE application_name = 'aimem-listen' AND datname = current_database()",
    );
    expect(cut.rows.length).toBeGreaterThanOrEqual(2);
    const task = newTask();
    const t0 = Date.now();
    expect((await rina.acquire({ task })).status).toBe(201);
    await s.waitFor(forTask(task), 3_000, "the event after the cut");
    expect(Date.now() - t0).toBeLessThanOrEqual(3_000);
    const end = Date.now() + 10_000;
    while (!(srv1.listening() && srv2.listening()) && Date.now() < end) await sleep(50);
    expect([srv1.listening(), srv2.listening()]).toEqual([true, true]);
    const next = newTask();
    const t1 = Date.now();
    await dana.acquire({ task: next });
    await s.waitFor(forTask(next), 2_000, "the event after recovery");
    expect(Date.now() - t1).toBeLessThan(2_000);
    s.close();
  });
});

describe("token and project (IZ-1/IZ-4/IZ-6 for events)", () => {
  it("a subscriber of alpha never gets an event of beta, live or replayed, on either instance (IZ-4)", async () => {
    const live1 = await events(srv1.url, "alpha", { since: "0" });
    const live2 = await events(srv2.url, "alpha", { since: "0" });
    const betaTasks: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = newTask();
      betaTasks.push(t);
      expect(
        (await (i % 2 ? bob : client(srv2.url, "beta", T.bob as string, "s-bob")).acquire({ task: t }))
          .status,
      ).toBe(201);
    }
    const marker = newTask();
    await dana.acquire({ task: marker });
    for (const s of [live1, live2]) {
      await s.waitFor(forTask(marker), 5_000);
      expect(ids(s.events)).toEqual((await tableSeqs("alpha")).filter((n) => n <= Number(s.lastId())));
      expect(s.events.every((e) => String(e.data.claim.task).startsWith("alpha:"))).toBe(true);
      expect(s.raw()).not.toMatch(/beta:/);
      for (const t of betaTasks) expect(s.raw()).not.toContain(t);
      s.close();
    }
    // A replay from a cursor just before the marker stays in alpha too (the marker's seq may be 1 when this test
    // runs alone, so the cursor is taken from it).
    const markerSeq = Number(live1.events.find((e) => e.data.claim?.task === `alpha:${marker}`)?.id ?? 1);
    const replay = await events(srv2.url, "alpha", { since: String(markerSeq - 1) });
    await replay.waitFor(forTask(marker), 5_000);
    expect(replay.raw()).not.toMatch(/beta:/);
    replay.close();
  });

  it("a token of another project, or a missing project, gets the same 404 on events", async () => {
    const a = await events(srv1.url, "beta", { token: T.bobAlpha });
    const b = await events(srv1.url, "nope", { token: T.bobAlpha });
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.raw()).toBe(b.raw());
  });

  type Kind = "revoked" | "expired" | "removed";
  async function victim(kind: Kind) {
    const user = `iz6${kind}${Math.floor(Math.random() * 1e6)}`;
    const tok = await token(db.pool, "alpha", user, { scopes: ["read"] });
    const change = async () => {
      if (kind === "revoked")
        await db.pool.query("UPDATE tokens SET revoked_at = clock_timestamp() WHERE hash = $1", [
          hashToken(tok),
        ]);
      else if (kind === "expired")
        await db.pool.query("UPDATE tokens SET expires_at = clock_timestamp() WHERE hash = $1", [
          hashToken(tok),
        ]);
      else
        await db.pool.query(
          "DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE handle = $1) AND project_id = (SELECT id FROM projects WHERE slug = 'alpha')",
          [user],
        );
    };
    return { tok, change };
  }

  for (const kind of ["revoked", "expired", "removed"] as const)
    it(`${kind} while the stream is open: the next event is not sent and the stream closes (IZ-6)`, async () => {
      const v = await victim(kind);
      const s = await events(srv1.url, "alpha", { token: v.tok });
      const control = await events(srv1.url);
      const before = newTask();
      await dana.acquire({ task: before });
      await s.waitFor(forTask(before));
      await v.change();
      const after = newTask();
      await dana.acquire({ task: after });
      // The control stream proves the event was there to send.
      await control.waitFor(forTask(after));
      expect(await endedWithin(s, 3_000), "stream closed").toBe(true);
      expect(s.raw()).not.toContain(after);
      control.close();
    });

  it("a quiet stream is closed at the next ping once access is gone (IZ-6, short ping)", async () => {
    const quick = await startServer({ sweepMs: false, pool: db.pool, streams: { pingMs: 300 } });
    try {
      for (const kind of ["revoked", "expired", "removed"] as const) {
        const v = await victim(kind);
        const s = await events(quick.url, "alpha", { token: v.tok });
        expect(s.status).toBe(200);
        await s.waitFor(() => s.pings >= 1, 2_000, "a ping");
        await v.change();
        expect(await endedWithin(s, 2_000), kind).toBe(true);
      }
      expect(quick.streams()).toBe(0);
    } finally {
      await quick.close();
    }
  });
});

describe("limits and cleanup (EV-8, EV-9, BR-2)", () => {
  it("the largest claim arrives whole on both instances (EV-8)", async () => {
    const s1 = await events(srv1.url);
    const s2 = await events(srv2.url);
    const task = newTask();
    const paths = Array.from({ length: 32 }, (_, i) => `p${String(i).padStart(2, "0")}/${"a".repeat(252)}`);
    const note = "ü字".repeat(250);
    const r = await dana.acquire({ task, paths, note });
    expect(r.status).toBe(201);
    for (const s of [s1, s2]) {
      await s.waitFor(forTask(task));
      const e = s.events.find((x) => x.data.claim.task === `alpha:${task}`) as SseEvent;
      expect(e.data.claim).toEqual(r.json.claim);
      expect(e.data.claim.paths).toHaveLength(32);
      expect(e.data.claim.note).toBe(r.json.claim.note);
      s.close();
    }
  });

  it("256 streams; the 257th gets 503 with Retry-After; a closed one frees its slot; claims still work (EV-9)", async () => {
    const full = await startServer({ sweepMs: false, pool: db.pool });
    const open: SseStream[] = [];
    try {
      for (let i = 0; i < 256; i++) {
        const s = await openStream(full.url, "/v1/projects/alpha/events", { token: T.viewer });
        expect(s.status).toBe(200);
        open.push(s);
      }
      expect(full.streams()).toBe(256);
      const extra = await openStream(full.url, "/v1/projects/alpha/events", { token: T.viewer });
      expect(extra.status).toBe(503);
      expect(extra.problem).toMatchObject({ code: "SYNC_FAILED" });
      expect(Number(extra.headers["retry-after"])).toBeGreaterThan(0);
      open.shift()?.close();
      const end = Date.now() + 5_000;
      while (full.streams() !== 255 && Date.now() < end) await sleep(20);
      expect(full.streams()).toBe(255);
      const again = await openStream(full.url, "/v1/projects/alpha/events", { token: T.viewer });
      expect(again.status).toBe(200);
      open.push(again);
      const task = newTask();
      const r = await client(full.url, "alpha", T.dana as string, "s-dana").acquire({ task });
      expect(r.status).toBe(201);
      await again.waitFor(forTask(task), 5_000);
    } finally {
      for (const s of open) s.close();
      const end = Date.now() + 5_000;
      while (full.streams() !== 0 && Date.now() < end) await sleep(20);
      expect(full.streams()).toBe(0);
      await full.close();
    }
  });

  it("no token and no token hash in the SSE bytes or headers (BR-2)", async () => {
    const s = await events(srv1.url, "alpha", { since: "0" });
    const top = await lastSeq();
    await s.waitFor((e) => Number(e.at(-1)?.id ?? 0) >= top, 10_000, "the whole backlog");
    const bytes = s.raw() + JSON.stringify(s.headers);
    const secrets = Object.values(T).flatMap((t) => [t, hashToken(t)]);
    for (const x of secrets) expect(bytes.includes(x)).toBe(false);
    // Positive control: the same check finds a value that is there.
    expect(`${bytes}${T.dana}`.includes(T.dana as string)).toBe(true);
    expect(bytes).not.toMatch(/aimem_[A-Za-z0-9_-]{43}/);
    s.close();
  });

  it("closed clients leave no stream behind on any instance", async () => {
    for (const s of streams) s.close();
    const end = Date.now() + 5_000;
    while ((srv1.streams() || srv2.streams()) && Date.now() < end) await sleep(20);
    expect([srv1.streams(), srv2.streams()]).toEqual([0, 0]);
  });
});
