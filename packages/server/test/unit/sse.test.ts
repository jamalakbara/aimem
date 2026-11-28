import { createServer, type IncomingMessage, request, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  EventHub,
  formatEvent,
  type Hooks,
  type ListenClient,
  MAX_STREAMS,
  PING_MS,
  readCursor,
  STREAM_BUFFER_BYTES,
  Streams,
} from "@aimem/server";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError, problemBody } from "../../src/problem.js";
import { openStream, type SseStream } from "../sse-client.js";

/**
 * Local tests of the SSE stream logic without PostgreSQL. A fake database answers the three queries of sse.ts
 * (events after a cursor, the project counter, the access check). The same behaviour against PostgreSQL is in
 * test/db/stream.test.ts, which runs only in the CI job `server`.
 */
class FakeDb {
  events = new Map<string, { seq: bigint; type: string; payload: unknown }[]>();
  allowed = true;
  failReads = false;
  queries = 0;
  accessChecks = 0;
  commit(projectId: string, type = "claim.created", extra: Record<string, unknown> = {}) {
    const list = this.events.get(projectId) ?? [];
    const seq = BigInt(list.length + 1);
    list.push({ seq, type, payload: { seq: Number(seq), type, ...extra } });
    this.events.set(projectId, list);
    return seq;
  }
  async query(sql: string, params: unknown[] = []) {
    this.queries++;
    await Promise.resolve();
    if (sql.includes("FROM events")) {
      if (this.failReads) throw Object.assign(new Error("Connection terminated"), { code: "57P01" });
      const [project, after, limit] = params as [string, string, number];
      const rows = (this.events.get(project) ?? [])
        .filter((e) => e.seq > BigInt(after))
        .slice(0, limit)
        .map((e) => ({ seq: e.seq.toString(), type: e.type, payload: e.payload }));
      return { rows };
    }
    if (sql.includes("project_event_seq")) {
      const n = (this.events.get(params[0] as string) ?? []).length;
      return { rows: [{ last_seq: String(n) }] };
    }
    if (sql.includes("FROM tokens")) this.accessChecks++;
    if (sql.includes("FROM tokens")) return { rows: this.allowed ? [{ "?column?": 1 }] : [] };
    throw new Error(`unexpected query ${sql}`);
  }
}

/** A hub that wakes the subscribers of a project on demand, like a notification would. */
class FakeHub {
  subs = new Map<string, Set<() => void>>();
  subscribe(projectId: string, wake: () => void) {
    const set = this.subs.get(projectId) ?? new Set();
    set.add(wake);
    this.subs.set(projectId, set);
    return () => set.delete(wake);
  }
  notify(projectId: string) {
    for (const w of this.subs.get(projectId) ?? []) w();
  }
  get size() {
    let n = 0;
    for (const s of this.subs.values()) n += s.size;
    return n;
  }
}

const CALLER = { projectId: "1", slug: "alpha", userId: "7", holder: "human:dana", tokenId: "9" };

interface Rig {
  db: FakeDb;
  hub: FakeHub;
  streams: Streams;
  base: string;
  /** Server-side sockets of the requests, in order (connection cleanup). */
  sockets: Socket[];
  open(path?: string, lastEventId?: string): Promise<SseStream>;
}
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((d) => s.close(d));
  }
});

async function rig(
  o: {
    maxStreams?: number;
    pingMs?: number;
    bufferBytes?: number;
    drainWaitMs?: number;
    hooks?: Hooks;
    /** Runs before `streams.start`, like the token check in server.ts. */
    beforeStart?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  } = {},
) {
  const db = new FakeDb();
  const hub = new FakeHub();
  const streams = new Streams(db, hub, o);
  const sockets: Socket[] = [];
  const server = createServer((req, res) => {
    sockets.push(req.socket);
    const url = new URL(req.url ?? "/", "http://x");
    void (async () => {
      try {
        await o.beforeStart?.(req, res);
        await streams.start(req, res, CALLER, readCursor(req, url));
      } catch (e) {
        const err = e as HttpError;
        res.writeHead(err.status, { "Content-Type": "application/problem+json", ...err.headers });
        res.end(problemBody(err));
      }
    })();
  });
  servers.push(server);
  await new Promise<void>((d) => server.listen(0, "127.0.0.1", d));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const r: Rig = {
    db,
    hub,
    streams,
    base,
    sockets,
    open: (path = "/events", lastEventId) =>
      openStream(base, path, lastEventId !== undefined ? { lastEventId } : {}),
  };
  return r;
}

const until = async (pred: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((d) => setTimeout(d, 5));
  }
};
const seqs = (s: SseStream) => s.events.map((e) => Number(e.id));
const req = (...pairs: string[]) => ({ rawHeaders: pairs }) as unknown as IncomingMessage;
const code = (fn: () => unknown) => {
  try {
    return String(fn());
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : "throw";
  }
};

describe("cursor rules (plan §5 step 1, EV-7)", () => {
  it("Last-Event-ID wins over since, both are checked, and the value is a BigInt", () => {
    const u = (q: string) => new URL(`http://x/events${q}`);
    expect(readCursor(req(), u(""))).toBeUndefined();
    expect(readCursor(req(), u("?since=0"))).toBe(0n);
    expect(readCursor(req(), u("?since=10"))).toBe(10n);
    expect(readCursor(req("Last-Event-ID", "12"), u("?since=3"))).toBe(12n);
    expect(readCursor(req("last-event-id", "9223372036854775807"), u(""))).toBe(9223372036854775807n);
    for (const q of [
      "?since=-1",
      "?since=abc",
      "?since=1.5",
      "?since=01",
      "?since=",
      "?since=1e3",
      "?since= 1",
    ])
      expect(
        code(() => readCursor(req(), u(q))),
        q,
      ).toBe("400 USAGE");
    expect(code(() => readCursor(req("Last-Event-ID", "x"), u("?since=1")))).toBe("400 USAGE");
    expect(code(() => readCursor(req("Last-Event-ID", "1"), u("?since=x")))).toBe("400 USAGE");
    expect(code(() => readCursor(req("Last-Event-ID", "1", "Last-Event-ID", "2"), u("")))).toBe("400 USAGE");
    expect(code(() => readCursor(req(), u("?since=1&since=2")))).toBe("400 USAGE");
    expect(code(() => readCursor(req(), u("?other=1")))).toBe("400 USAGE");
  });

  it("formats one event per message with its id, type and one-line JSON (plan §6.3)", () => {
    const text = formatEvent("10", "claim.created", { seq: 10, note: "a\nb" });
    expect(text).toBe('id: 10\nevent: claim.created\ndata: {"seq":10,"note":"a\\nb"}\n\n');
  });

  it("keeps the documented limits", () => {
    expect([MAX_STREAMS, PING_MS, STREAM_BUFFER_BYTES]).toEqual([256, 15_000, 1024 * 1024]);
  });
});

describe("one stream, without a database (EV-1, EV-3, EV-4, EV-7 locally)", () => {
  it("sends the backlog after the cursor, then new events, in order and once", async () => {
    const r = await rig();
    for (let i = 0; i < 11; i++) r.db.commit("1");
    const s = await r.open("/events?since=8");
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(s.headers["cache-control"]).toBe("no-store");
    expect(s.headers["x-accel-buffering"]).toBe("no");
    // 9 → 10 → 11: compared as numbers, not text.
    await s.waitForCount(3);
    expect(seqs(s)).toEqual([9, 10, 11]);
    r.db.commit("1");
    r.db.commit("1");
    r.hub.notify("1");
    r.hub.notify("1");
    r.hub.notify("1");
    await s.waitForCount(5);
    await new Promise((d) => setTimeout(d, 50));
    expect(seqs(s)).toEqual([9, 10, 11, 12, 13]);
    expect(s.events.map((e) => e.event)).toEqual(Array(5).fill("claim.created"));
    expect(s.events[0]?.data).toEqual({ seq: 9, type: "claim.created" });
    s.close();
  });

  it("without a cursor only new events come; a cursor ahead is refused before the stream starts", async () => {
    const r = await rig();
    r.db.commit("1");
    r.db.commit("1");
    const s = await r.open();
    await new Promise((d) => setTimeout(d, 50));
    expect(s.events).toEqual([]);
    r.db.commit("1");
    r.hub.notify("1");
    await s.waitForCount(1);
    expect(seqs(s)).toEqual([3]);
    const ahead = await r.open("/events?since=4");
    expect(ahead.status).toBe(400);
    expect(ahead.problem).toMatchObject({ code: "USAGE" });
    const at = await r.open("/events?since=3");
    expect(at.status).toBe(200);
    await until(() => r.streams.count === 2);
    s.close();
    at.close();
    await until(() => r.streams.count === 0);
    expect(r.hub.size).toBe(0);
  });

  it("Last-Event-ID resumes after the last event received (reconnect)", async () => {
    const r = await rig();
    for (let i = 0; i < 5; i++) r.db.commit("1");
    const a = await r.open("/events?since=0");
    await a.waitForCount(5);
    a.close();
    for (let i = 0; i < 3; i++) r.db.commit("1");
    const b = await r.open("/events?since=0", a.lastId());
    await b.waitForCount(3);
    expect(seqs(b)).toEqual([6, 7, 8]);
    b.close();
  });

  it("an event that commits between the backlog read and its send arrives exactly once (EV-4)", async () => {
    let db!: FakeDb;
    let hub!: FakeHub;
    let once = true;
    const r = await rig({
      hooks: {
        stream: (point) => {
          if (point === "backlog" && once) {
            once = false;
            db.commit("1");
            hub.notify("1");
          }
        },
      },
    });
    db = r.db;
    hub = r.hub;
    r.db.commit("1");
    const s = await r.open("/events?since=0");
    await s.waitForCount(2);
    await new Promise((d) => setTimeout(d, 50));
    expect(seqs(s)).toEqual([1, 2]);
    s.close();
  });

  it("an event of another project is never sent (IZ-4 locally)", async () => {
    const r = await rig();
    const s = await r.open("/events?since=0");
    r.db.commit("2");
    r.hub.notify("2");
    r.hub.notify("1");
    r.db.commit("1");
    r.hub.notify("1");
    await s.waitForCount(1);
    await new Promise((d) => setTimeout(d, 50));
    expect(seqs(s)).toEqual([1]);
    s.close();
  });

  it("reads in batches, so a long backlog arrives whole and in order", async () => {
    const r = await rig();
    for (let i = 0; i < 450; i++) r.db.commit("1");
    const s = await r.open("/events?since=0");
    await s.waitForCount(450);
    expect(seqs(s)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
    s.close();
  });
});

describe("access, limits and cleanup (IZ-6, EV-9, plan A12)", () => {
  it("revoked access: the next event is not sent and the stream closes", async () => {
    const r = await rig();
    const s = await r.open("/events?since=0");
    r.db.commit("1");
    r.hub.notify("1");
    await s.waitForCount(1);
    r.db.allowed = false;
    r.db.commit("1");
    r.hub.notify("1");
    await s.ended;
    expect(seqs(s)).toEqual([1]);
    expect(s.raw()).not.toContain("id: 2");
    await until(() => r.streams.count === 0);
  });

  it("a quiet stream is closed at the next ping once access is gone", async () => {
    const r = await rig({ pingMs: 40 });
    const s = await r.open();
    await s.waitFor(() => s.pings >= 1, 2_000, "a ping");
    r.db.allowed = false;
    const t0 = Date.now();
    await s.ended;
    expect(Date.now() - t0).toBeLessThan(1_000);
    await until(() => r.streams.count === 0);
  });

  it("one stream more than the limit gets 503 with Retry-After; a closed one frees its slot", async () => {
    const r = await rig({ maxStreams: 3 });
    const open = [await r.open(), await r.open(), await r.open()];
    expect(open.map((s) => s.status)).toEqual([200, 200, 200]);
    const full = await r.open();
    expect(full.status).toBe(503);
    expect(full.problem).toMatchObject({ code: "SYNC_FAILED" });
    expect(full.headers["retry-after"]).toBeDefined();
    open[0]?.close();
    await until(() => r.streams.count === 2);
    const again = await r.open();
    expect(again.status).toBe(200);
    r.db.commit("1");
    r.hub.notify("1");
    await again.waitForCount(1);
    for (const s of [...open.slice(1), again]) s.close();
    await until(() => r.streams.count === 0);
    expect(r.hub.size).toBe(0);
  });

  it("a refused cursor does not keep a slot or a subscription", async () => {
    const r = await rig({ maxStreams: 1 });
    expect((await r.open("/events?since=5")).status).toBe(400);
    expect(r.streams.count).toBe(0);
    expect(r.hub.size).toBe(0);
    const s = await r.open();
    expect(s.status).toBe(200);
    s.close();
  });

  it("a reader that stops reading is dropped at the buffer limit; others are not held up", async () => {
    const r = await rig({ bufferBytes: 64 * 1024, drainWaitMs: 300 });
    const slow = await r.open("/events?since=0");
    const fast = await r.open("/events?since=0");
    slow.pause();
    const big = "x".repeat(16 * 1024);
    for (let i = 0; i < 400; i++) {
      r.db.commit("1", "claim.created", { note: big });
      r.hub.notify("1");
    }
    await fast.waitForCount(400, 15_000);
    await until(() => r.streams.count === 1, 10_000);
    fast.close();
    await until(() => r.streams.count === 0);
  });

  it("a client that leaves while its token is still being checked does not keep a slot (QA Q1)", async () => {
    let started = false;
    const r = await rig({
      pingMs: 20,
      // Hold the start until the client's connection is gone, as a slow token check would.
      beforeStart: async (_req, res) => {
        const end = Date.now() + 3_000;
        while (!(res.socket?.destroyed ?? true) && Date.now() < end)
          await new Promise((d) => setTimeout(d, 5));
        started = true;
      },
    });
    const url = new URL(`${r.base}/events?since=0`);
    const req = request({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      agent: false,
    });
    req.on("error", () => undefined);
    req.end();
    setTimeout(() => req.destroy(), 50);
    await until(() => started, 3_000);
    await new Promise((d) => setTimeout(d, 20));
    expect(r.streams.count).toBe(0);
    expect(r.hub.size).toBe(0);
    // No ping keeps checking access for a client that is not there.
    const checks = r.db.accessChecks;
    await new Promise((d) => setTimeout(d, 150));
    expect(r.db.accessChecks).toBe(checks);
    // The slot is really free: a limit of one still admits the next client.
    const next = await r.open();
    expect(next.status).toBe(200);
    next.close();
    await until(() => r.streams.count === 0);
  });

  it("access is checked again after waiting for a slow reader, before writing more (QA Q4)", async () => {
    // The ping is far away, so only the check after the wait can stop the stream.
    const r = await rig({ bufferBytes: 64 * 1024, drainWaitMs: 5_000, pingMs: 60_000 });
    const s = await r.open("/events?since=0");
    s.pause();
    // 300 × 128 KB is far more than the loopback socket buffers hold, so the writer really has to wait.
    const big = "y".repeat(128 * 1024);
    for (let i = 0; i < 300; i++) r.db.commit("1", "claim.created", { note: big });
    r.hub.notify("1");
    // The first read is 200 events with one access check; the writer then waits for the paused reader.
    await until(() => r.db.accessChecks >= 1);
    await new Promise((d) => setTimeout(d, 500));
    r.db.allowed = false;
    s.resume();
    await s.ended;
    // Without the check after the wait, the whole first read (200 events) would be written after the revocation.
    expect(s.events.length).toBeLessThan(200);
    expect(seqs(s)).toEqual(Array.from({ length: s.events.length }, (_, i) => i + 1));
    await until(() => r.streams.count === 0);
  });

  it("a closed stream whose reader takes nothing is cut after the wait, not left open (QA N1)", async () => {
    // A large buffer: everything is queued at once, so no wait happens before the close.
    const r = await rig({ bufferBytes: 64 * 1024 * 1024, drainWaitMs: 300, pingMs: 60_000 });
    const s = await r.open("/events?since=0");
    s.pause();
    // 300 × 128 KB: queued in the response at once, more than the socket buffers take.
    const big = "z".repeat(128 * 1024);
    for (let i = 0; i < 300; i++) r.db.commit("1", "claim.created", { note: big });
    r.hub.notify("1");
    await until(() => r.db.accessChecks >= 2);
    await new Promise((d) => setTimeout(d, 200));
    r.streams.closeAll();
    expect(r.streams.count).toBe(0);
    const socket = r.sockets.at(-1) as Socket;
    expect(socket.destroyed).toBe(false);
    // Cut, or nothing left to send. 38 MB do not fit the socket buffers of a paused reader, so in practice only the
    // cut ends it; the bytes may be waiting in the response or (Windows) already in the socket.
    await until(() => socket.destroyed || socket.writableLength === 0, 2_000);
    s.close();
  });

  it("a failed read does not close the stream; it tries again", async () => {
    const r = await rig();
    const s = await r.open("/events?since=0");
    r.db.failReads = true;
    r.db.commit("1");
    r.hub.notify("1");
    await new Promise((d) => setTimeout(d, 100));
    expect(s.isEnded()).toBe(false);
    r.db.failReads = false;
    await s.waitForCount(1, 3_000);
    s.close();
  });

  it("shutting down ends every stream", async () => {
    const r = await rig();
    const a = await r.open();
    const b = await r.open();
    r.streams.closeAll();
    await Promise.all([a.ended, b.ended]);
    expect(r.streams.count).toBe(0);
  });
});

/** A fake LISTEN connection; `kill()` is what pg_terminate_backend looks like from the client. */
class FakeListen implements ListenClient {
  static made: FakeListen[] = [];
  static refuse = 0;
  handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  queries: string[] = [];
  ended = false;
  constructor() {
    FakeListen.made.push(this);
  }
  async connect() {
    if (FakeListen.refuse > 0) {
      FakeListen.refuse--;
      throw new Error("ECONNREFUSED");
    }
  }
  async query(sql: string) {
    this.queries.push(sql);
  }
  async end() {
    this.ended = true;
  }
  on(event: string, fn: (...a: unknown[]) => void) {
    const list = this.handlers[event] ?? [];
    list.push(fn);
    this.handlers[event] = list;
    return this;
  }
  emit(event: string, ...a: unknown[]) {
    for (const f of this.handlers[event] ?? []) f(...a);
  }
  kill() {
    this.emit("error", new Error("terminating connection due to administrator command"));
    this.emit("end");
  }
}

describe("LISTEN connection per instance (plan §5, EV-5 locally)", () => {
  const make = async (o: { pollMs?: number; min?: number; max?: number } = {}) => {
    FakeListen.made = [];
    FakeListen.refuse = 0;
    const hub = new EventHub({} as never, {
      connect: () => new FakeListen(),
      pollMs: o.pollMs ?? 30,
      reconnectMinMs: o.min ?? 20,
      reconnectMaxMs: o.max ?? 80,
    });
    return hub;
  };

  it("listens on the events channel and wakes only the subscribers of the notified project", async () => {
    const hub = await make();
    await hub.start();
    expect(hub.listening).toBe(true);
    expect(FakeListen.made[0]?.queries).toEqual(["LISTEN aimem_events"]);
    const woke: string[] = [];
    const offA = hub.subscribe("1", () => woke.push("a"));
    hub.subscribe("2", () => woke.push("b"));
    const c = FakeListen.made[0];
    c?.emit("notification", { channel: "aimem_events", payload: '{"project_id":"1","seq":3}' });
    c?.emit("notification", { channel: "aimem_events", payload: '{"project_id":1,"seq":4}' });
    c?.emit("notification", { channel: "other", payload: '{"project_id":"2"}' });
    c?.emit("notification", { channel: "aimem_events", payload: "not json" });
    expect(woke).toEqual(["a", "a"]);
    offA();
    expect(hub.size).toBe(1);
    await hub.close();
    expect(c?.ended).toBe(true);
  });

  it("after a cut it polls, reconnects with growing waits, and wakes everyone to catch up", async () => {
    const hub = await make({ pollMs: 25, min: 40, max: 100 });
    await hub.start();
    let wakes = 0;
    hub.subscribe("1", () => wakes++);
    FakeListen.refuse = 2;
    FakeListen.made[0]?.kill();
    expect(hub.listening).toBe(false);
    // Polling while down: the subscriber is woken without any notification.
    await until(() => wakes >= 2, 1_000);
    // Two refused attempts (40 ms, 80 ms), then the third (100 ms cap) connects.
    await until(() => hub.listening, 2_000);
    expect(FakeListen.made.length).toBe(4);
    expect(FakeListen.made[3]?.queries).toEqual(["LISTEN aimem_events"]);
    const before = wakes;
    await new Promise((d) => setTimeout(d, 120));
    // Polling stopped once LISTEN was back (at most the catch-up wake).
    expect(wakes - before).toBeLessThanOrEqual(1);
    await hub.close();
  });

  it("a second cut after recovery is handled the same way, and close stops all timers", async () => {
    const hub = await make();
    await hub.start();
    FakeListen.made[0]?.kill();
    await until(() => hub.listening);
    FakeListen.made.at(-1)?.kill();
    await until(() => hub.listening);
    expect(FakeListen.made.length).toBe(3);
    await hub.close();
    FakeListen.made.at(-1)?.kill();
    await new Promise((d) => setTimeout(d, 150));
    expect(FakeListen.made.length).toBe(3);
    expect(hub.listening).toBe(false);
  });

  it("a database that is down at start does not stop the server: it polls and keeps trying", async () => {
    const hub = await make({ pollMs: 20, min: 20 });
    FakeListen.refuse = 1;
    await hub.start();
    expect(hub.listening).toBe(false);
    await until(() => hub.listening, 1_000);
    await hub.close();
  });
});
