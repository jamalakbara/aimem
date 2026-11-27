import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLatencyProxy } from "../../bench/latency-proxy.ts";
import { HOLDER, type ProfileSpec, runMeasurement, send } from "../../bench/measure.ts";
import { type ProfileResult, problems, verdict } from "../../bench/stats.ts";

/**
 * The p95 harness against plain stand-in servers (QA 6.1b P1–P3), without PostgreSQL. The stand-ins answer
 * `healthz`, accept a claim with 201 and send its `claim.created` to every open stream; like any HTTP server they
 * close the connection after answering a client that asked for `Connection: close`. The times seen here are
 * those of stand-ins on one machine and say nothing about the real server.
 */
interface Behaviour {
  /** Answer delay for POST number `i` (0-based). */
  postDelayMs?: (i: number) => number;
  /** False: POST number `i` is never answered. */
  answerPost?: (i: number) => boolean;
  /** False: the stream request is never answered. */
  openStream?: boolean;
}
interface Bus {
  streams: Set<ServerResponse>;
  seq: number;
}
const servers: { server: Server; sockets: Set<Socket> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    for (const x of s.sockets) x.destroy();
    await new Promise((d) => s.server.close(d));
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function standIn(name: string, bus: Bus, b: Behaviour = {}) {
  let posts = 0;
  const sockets = new Set<Socket>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const head = { "Aimem-Instance": name };
    if (req.url === "/healthz") {
      res.writeHead(200, { ...head, "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (req.method === "GET" && req.url?.endsWith("/events")) {
      if (b.openStream === false) return; // never answered
      res.writeHead(200, { ...head, "Content-Type": "text/event-stream" });
      res.flushHeaders();
      bus.streams.add(res);
      res.on("close", () => bus.streams.delete(res));
      return;
    }
    if (req.method === "POST") {
      const i = posts++;
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        if (b.answerPost && !b.answerPost(i)) return; // never answered
        const { task } = JSON.parse(body) as { task: string };
        const seq = ++bus.seq;
        const data = { seq, type: "claim.created", claim: { task, holder: HOLDER } };
        for (const s of bus.streams)
          s.write(`id: ${seq}\nevent: claim.created\ndata: ${JSON.stringify(data)}\n\n`);
        setTimeout(() => {
          res.writeHead(201, { ...head, "Content-Type": "application/json" });
          res.end("{}");
        }, b.postDelayMs?.(i) ?? 0);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((d) => server.listen(0, "127.0.0.1", d));
  servers.push({ server, sockets });
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, port, open: () => sockets.size };
}

const spec = (
  name: ProfileSpec["name"],
  a: string,
  aName: string,
  b: string,
  bName: string,
): ProfileSpec => ({
  name,
  slug: "bench",
  writer: "w",
  reader: "r",
  a: { base: a, expected: aName },
  b: { base: b, expected: bName },
});
const outFile = () => {
  const d = mkdtempSync(join(tmpdir(), "aimem-bench-"));
  dirs.push(d);
  return join(d, "report.json");
};
/** Resolves to the value, or to "did not finish" after `ms`: a hanging run fails the test instead of the suite. */
const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"did not finish">((d) => setTimeout(() => d("did not finish"), ms))]);
const SMALL = { warmup: 1, measured: 4, sampleTimeoutMs: 400, stepTimeoutMs: 400, runDeadlineMs: 20_000 };

describe("P1: replies on connections the server closes normally go through the delay queue", () => {
  it("every Connection: close request through the proxy gets its whole answer after ≥ 100 ms", async () => {
    const s = await standIn("i1", { streams: new Set(), seq: 0 });
    const proxy = await startLatencyProxy({ targetPort: s.port, delayMs: 50 });
    try {
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await send(`http://127.0.0.1:${proxy.port}`, { method: "GET", path: "/healthz" });
        expect(r, `request ${i}`).toEqual({ status: 200, instance: "i1" });
        expect(performance.now() - t0).toBeGreaterThanOrEqual(100);
      }
    } finally {
      await proxy.close();
    }
  });

  it("all three profiles finish against stand-ins, profile 3 through two proxies, and teardown leaves nothing open", async () => {
    const bus: Bus = { streams: new Set(), seq: 0 };
    const i1 = await standIn("i1", bus);
    const i2 = await standIn("i2", bus);
    const out = outFile();
    let proxies: { close(): Promise<void>; connections(): number }[] = [];
    const run = await within(
      runMeasurement({
        out,
        meta: { kind: "stand-in" },
        limits: SMALL,
        setup: async ({ onCleanup }) => {
          const pa = await startLatencyProxy({ targetPort: i1.port, delayMs: 50 });
          const pb = await startLatencyProxy({ targetPort: i2.port, delayMs: 50 });
          proxies = [pa, pb];
          onCleanup(pa.close);
          onCleanup(pb.close);
          const viaA = `http://127.0.0.1:${pa.port}`;
          return [
            spec("same-instance", i1.url, "i1", i1.url, "i1"),
            spec("two-instances", i1.url, "i1", i2.url, "i2"),
            {
              ...spec("two-instances-proxied", viaA, "i1", `http://127.0.0.1:${pb.port}`, "i2"),
              rttBase: viaA,
            },
          ];
        },
      }),
      15_000,
    );
    expect(run).not.toBe("did not finish");
    if (run === "did not finish") return;
    const profiles = run.report.profiles as ProfileResult[];
    expect(profiles.map((p) => [p.name, p.samples.length, p.failures])).toEqual([
      ["same-instance", 4, []],
      ["two-instances", 4, []],
      ["two-instances-proxied", 4, []],
    ]);
    const p3 = profiles[2] as ProfileResult;
    expect(Math.min(...(p3.rttMs ?? [0]))).toBeGreaterThanOrEqual(100);
    expect(Math.min(...p3.samples)).toBeGreaterThanOrEqual(100);
    expect(proxies.every((p) => p.connections() > 0)).toBe(true);
    // Teardown: the stand-ins have no connection left open by the harness.
    const end = Date.now() + 2_000;
    while ((i1.open() || i2.open()) && Date.now() < end) await new Promise((d) => setTimeout(d, 20));
    expect([i1.open(), i2.open()]).toEqual([0, 0]);
    expect(JSON.parse(readFileSync(out, "utf8")).verdict).toEqual(run.verdict);
  });
});

describe("P2: one 5 s limit from sending the POST to receiving the event", () => {
  it("a POST answered after the limit fails the run, even when its event came early", async () => {
    const bus: Bus = { streams: new Set(), seq: 0 };
    const i1 = await standIn("i1", bus, { postDelayMs: (i) => (i === 2 ? 600 : 0) });
    const out = outFile();
    const run = await within(
      runMeasurement({
        out,
        meta: {},
        limits: SMALL,
        setup: async () => [spec("same-instance", i1.url, "i1", i1.url, "i1")],
      }),
      10_000,
    );
    expect(run).not.toBe("did not finish");
    if (run === "did not finish") return;
    const p = (run.report.profiles as ProfileResult[])[0] as ProfileResult;
    expect(p.failures.map((f) => [f.kind, f.sample])).toEqual([["timeout", 2]]);
    expect(run.verdict.result).not.toBe("passed in simulation");
  });

  it("the validity rules reject any sample over 5000 ms on their own", () => {
    const n = (k: number, v: number) => Array.from({ length: k }, () => v);
    const r: ProfileResult = {
      name: "same-instance",
      instances: { a: n(320, 0).map(() => "i1"), b: "i1" },
      expected: { a: "i1", b: "i1" },
      warmup: n(20, 10),
      samples: [...n(299, 10), 5_600],
      failures: [],
    };
    expect(problems(r).join()).toMatch(/1 samples? over 5000 ms/);
    expect(verdict([r]).result).not.toBe("passed in simulation");
  });
});

describe("P3: every wait is bounded, and a failed run still writes its report and tears down", () => {
  it("a POST that is never answered ends as a timeout, with the report written", async () => {
    const bus: Bus = { streams: new Set(), seq: 0 };
    const i1 = await standIn("i1", bus, { answerPost: (i) => i !== 1 });
    const out = outFile();
    let cleaned = false;
    const run = await within(
      runMeasurement({
        out,
        meta: {},
        limits: SMALL,
        setup: async ({ onCleanup }) => {
          onCleanup(() => {
            cleaned = true;
          });
          return [spec("same-instance", i1.url, "i1", i1.url, "i1")];
        },
      }),
      10_000,
    );
    expect(run).not.toBe("did not finish");
    if (run === "did not finish") return;
    const p = (run.report.profiles as ProfileResult[])[0] as ProfileResult;
    expect(p.failures.map((f) => [f.kind, f.sample])).toEqual([["timeout", 1]]);
    expect(p.samples).toHaveLength(3);
    expect(cleaned).toBe(true);
    expect(JSON.parse(readFileSync(out, "utf8")).verdict.result).not.toBe("passed in simulation");
  });

  it("a stream or a round trip that never answers is bounded too", async () => {
    const bus: Bus = { streams: new Set(), seq: 0 };
    const silent = await standIn("i1", bus, { openStream: false });
    const out = outFile();
    const run = await within(
      runMeasurement({
        out,
        meta: {},
        limits: SMALL,
        setup: async () => [spec("same-instance", silent.url, "i1", silent.url, "i1")],
      }),
      10_000,
    );
    expect(run).not.toBe("did not finish");
    if (run === "did not finish") return;
    const p = (run.report.profiles as ProfileResult[])[0] as ProfileResult;
    expect(p.failures[0]?.kind).toBe("error");
    expect(p.failures[0]?.detail).toMatch(/stream/);
    expect(existsSync(out)).toBe(true);
  });

  it("the whole run has a deadline: a step that hangs stops the run, cleanup runs, the report is written", async () => {
    const out = outFile();
    const order: string[] = [];
    const t0 = Date.now();
    const run = await within(
      runMeasurement({
        out,
        meta: {},
        limits: { ...SMALL, runDeadlineMs: 300 },
        setup: async ({ onCleanup }) => {
          onCleanup(() => {
            order.push("first registered");
          });
          onCleanup(() => {
            order.push("last registered");
          });
          await new Promise(() => undefined); // never resolves
          return [];
        },
      }),
      10_000,
    );
    expect(run).not.toBe("did not finish");
    if (run === "did not finish") return;
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(order).toEqual(["last registered", "first registered"]);
    expect(run.verdict.result).toBe("not valid");
    expect(run.verdict.reasons[0]).toMatch(/run stopped: .*deadline/);
    expect(JSON.parse(readFileSync(out, "utf8")).verdict.reasons[0]).toMatch(/deadline/);
  });
});
