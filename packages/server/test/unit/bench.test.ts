import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { startLatencyProxy } from "../../bench/latency-proxy.ts";
import {
  LIMIT_MS,
  MEASURED,
  MIN_RTT_MS,
  nearestRank,
  type ProfileResult,
  problems,
  summarize,
  verdict,
  WARMUP,
} from "../../bench/stats.ts";

/**
 * Local checks of the p95 harness (plan 6.1 §8) without PostgreSQL: the numbers, the validity rules, the delay
 * proxy, and that a failed run still writes its JSON report. The measurement itself runs only in the CI job `p95`.
 */
const range = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const profile = (over: Partial<ProfileResult> = {}): ProfileResult => ({
  name: "two-instances",
  instances: { a: range(WARMUP + MEASURED, () => "i1"), b: "i2" },
  expected: { a: "i1", b: "i2" },
  warmup: range(WARMUP, () => 20),
  samples: range(MEASURED, (i) => i + 1),
  failures: [],
  ...over,
});
const all = (over: Partial<ProfileResult>[] = [{}, {}, {}]): ProfileResult[] => [
  profile({
    name: "same-instance",
    instances: { a: range(WARMUP + MEASURED, () => "i1"), b: "i1" },
    expected: { a: "i1", b: "i1" },
    ...over[0],
  }),
  profile({ name: "two-instances", ...over[1] }),
  profile({
    name: "two-instances-proxied",
    rttMs: [101, 102],
    samples: range(MEASURED, (i) => 100 + i),
    ...over[2],
  }),
];

describe("nearest-rank percentiles (plan §8)", () => {
  it("p95 of 300 samples is the 285th value in ascending order", () => {
    const shuffled = range(MEASURED, (i) => i + 1).sort(() => Math.random() - 0.5);
    expect(nearestRank(shuffled, 95)).toBe(285);
    expect(summarize(shuffled)).toEqual({ n: 300, min: 1, p50: 150, p95: 285, p99: 297, max: 300 });
  });

  it("handles small and edge inputs without interpolating", () => {
    expect(nearestRank([5], 95)).toBe(5);
    expect(nearestRank([1, 2], 50)).toBe(1);
    expect(nearestRank([1, 2], 51)).toBe(2);
    expect(nearestRank([3, 1, 2], 100)).toBe(3);
    expect(() => nearestRank([], 95)).toThrow();
    expect(() => nearestRank([1], 0)).toThrow();
    expect(summarize([]).n).toBe(0);
  });
});

describe("validity and verdict (plan §8, QA W11)", () => {
  it("three clean profiles under 1 s: at best 'passed in simulation'", () => {
    expect(verdict(all())).toEqual({ result: "passed in simulation", reasons: [] });
  });

  it("a p95 at or over 1000 ms fails", () => {
    const slow = range(MEASURED, (i) => (i < 284 ? 10 : LIMIT_MS));
    const v = verdict(all([{}, { samples: slow }, {}]));
    expect(v.result).toBe("failed");
    expect(v.reasons.join()).toMatch(/two-instances: p95 1000\.0 ms ≥ 1000 ms/);
    // 284 fast samples and 16 slow ones: the 285th is slow.
    expect(nearestRank(slow, 95)).toBe(LIMIT_MS);
    expect(
      nearestRank(
        range(MEASURED, (i) => (i < 285 ? 10 : LIMIT_MS)),
        95,
      ),
    ).toBe(10);
  });

  it("any timeout, missing, duplicate or non-201 fails the run; nothing is discarded", () => {
    for (const kind of ["timeout", "missing", "duplicate", "status"] as const) {
      const v = verdict(all([{}, { failures: [{ kind, sample: 7, detail: "x" }] }, {}]));
      expect(v.result, kind).toBe("failed");
      expect(v.reasons.join(), kind).toContain(`sample 7 ${kind}`);
    }
  });

  it("wrong sample counts, wrong instances, or a missing profile make the run not valid", () => {
    expect(verdict(all([{ samples: range(299, () => 1) }, {}, {}])).result).toBe("not valid");
    expect(verdict(all([{ warmup: [] }, {}, {}])).result).toBe("not valid");
    expect(verdict(all([{}, { instances: { a: range(320, () => "i1"), b: "i1" } }, {}])).result).toBe(
      "not valid",
    );
    expect(verdict(all([{}, { expected: { a: "i1", b: "i1" } }, {}])).result).toBe("not valid");
    expect(verdict(all().slice(0, 2)).reasons).toContain(
      "two-instances-proxied: profile did not run (run not valid)",
    );
    expect(verdict([], "DATABASE_URL is not set").result).toBe("not valid");
  });

  it("profile 3 needs a measured round trip ≥ 100 ms and every sample ≥ 100 ms", () => {
    const noRtt = verdict(all([{}, {}, { rttMs: [] }]));
    expect(noRtt.result).toBe("not valid");
    const fastRtt = verdict(all([{}, {}, { rttMs: [99.9, 150] }]));
    expect(fastRtt.reasons.join()).toMatch(/round trip 99\.9 ms < 100 ms \(run not valid\)/);
    const shortSample = verdict(all([{}, {}, { samples: range(MEASURED, (i) => (i === 3 ? 99 : 120)) }]));
    expect(shortSample.result).toBe("not valid");
    expect(problems(profile({ name: "two-instances", rttMs: [] }))).toEqual([]);
    expect(MIN_RTT_MS).toBe(100);
  });
});

describe("delay proxy (profile 3)", () => {
  const servers: { close(): unknown }[] = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });

  /** An echo server: each received chunk comes straight back. */
  async function echo() {
    const sockets = new Set<Socket>();
    const s = createServer((c) => {
      sockets.add(c);
      c.setNoDelay(true);
      c.on("data", (d) => c.write(d));
      c.on("close", () => sockets.delete(c));
    });
    await new Promise<void>((d) => s.listen(0, "127.0.0.1", d));
    servers.push({
      close: () => {
        for (const x of sockets) x.destroy();
        s.close();
      },
    });
    return (s.address() as { port: number }).port;
  }

  async function connect(port: number) {
    const { connect: net } = await import("node:net");
    const c = net(port, "127.0.0.1");
    c.setNoDelay(true);
    await new Promise<void>((d) => c.once("connect", () => d()));
    const got: { text: string; at: number }[] = [];
    c.on("data", (d) => got.push({ text: String(d), at: performance.now() }));
    return { c, got };
  }

  it("delays each direction by the set time, so a round trip takes at least twice that", async () => {
    const proxy = await startLatencyProxy({ targetPort: await echo(), delayMs: 50 });
    servers.push(proxy);
    const { c, got } = await connect(proxy.port);
    const t0 = performance.now();
    c.write("ping");
    while (got.length === 0) await new Promise((d) => setTimeout(d, 2));
    const rtt = (got[0]?.at ?? 0) - t0;
    expect(rtt).toBeGreaterThanOrEqual(100);
    expect(rtt).toBeLessThan(400);
    c.destroy();
  });

  it("keeps the order and does not add delays up for chunks sent back to back", async () => {
    const proxy = await startLatencyProxy({ targetPort: await echo(), delayMs: 50 });
    servers.push(proxy);
    const { c, got } = await connect(proxy.port);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      c.write(`<${i}>`);
      await new Promise((d) => setTimeout(d, 5));
    }
    const all10 = () => got.map((g) => g.text).join("");
    while (!all10().includes("<9>")) await new Promise((d) => setTimeout(d, 2));
    expect(all10()).toBe(range(10, (i) => `<${i}>`).join(""));
    // Ten chunks 5 ms apart: the last is back after ~45 + 100 ms, not 10 × 100 ms.
    const last = (got.at(-1)?.at ?? 0) - t0;
    expect(last).toBeGreaterThanOrEqual(100);
    expect(last).toBeLessThan(600);
    expect(proxy.connections()).toBe(1);
    c.destroy();
  });
});

describe("a run that cannot start still writes its report", () => {
  it("exits 1 with verdict 'not valid' and a JSON report, without printing the database address", async () => {
    const port = await new Promise<number>((done) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => done(p));
      });
    });
    const dir = mkdtempSync(join(tmpdir(), "aimem-p95-"));
    try {
      const out = join(dir, "report.json");
      const script = fileURLToPath(new URL("../../bench/claim-visibility.ts", import.meta.url));
      const url = `postgres://bench:not-a-real-password@127.0.0.1:${port}/none`;
      const r = spawnSync(process.execPath, [script, "--out", out], {
        env: { PATH: process.env.PATH ?? "", DATABASE_URL: url },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(r.status).toBe(1);
      const report = JSON.parse(readFileSync(out, "utf8"));
      expect(report.verdict.result).toBe("not valid");
      expect(report.verdict.reasons[0]).toMatch(/^run stopped: /);
      expect(report.verdict.reasons).toContain("same-instance: profile did not run (run not valid)");
      expect(report.label).toMatch(/simulation/);
      expect(report.profiles).toEqual([]);
      for (const text of [r.stdout, r.stderr, readFileSync(out, "utf8")])
        expect(text).not.toContain("not-a-real-password");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
