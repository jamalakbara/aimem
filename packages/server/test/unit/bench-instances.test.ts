import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startInstances } from "../../bench/instances.ts";
import { runMeasurement } from "../../bench/measure.ts";

/**
 * Teardown of the harness's server processes (QA 6.1b P3 recheck), with a small stand-in server script instead of
 * the real one and no database. Each stand-in writes its PID to a file at start, so the test can check that no
 * child is alive once the harness has returned, and kill leftovers as a fallback.
 */
const STAND_IN = `
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
const name = process.env.AIMEM_INSTANCE;
const mode = process.env["STANDIN_" + name] ?? "ok";
writeFileSync(process.env.STANDIN_DIR + "/pid-" + name + "-" + process.pid, "");
if (mode === "exit") process.exit(3);
if (mode === "never") setInterval(() => undefined, 1000);
else {
  if (mode === "ignore-term") process.on("SIGTERM", () => undefined);
  const s = createServer((_q, r) => r.end("{}"));
  s.listen(0, "127.0.0.1", () =>
    process.stdout.write("aimem server listening on http://127.0.0.1:" + s.address().port + " as " + name + "\\n"),
  );
}
`;

let dir: string;
let bin: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-instances-"));
  bin = join(dir, "stand-in.mjs");
  writeFileSync(bin, STAND_IN);
});
const pids = () =>
  readdirSync(dir)
    .filter((f) => f.startsWith("pid-"))
    .map((f) => Number(f.split("-").at(-1)));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// Fallback cleanup: whatever the harness left, the test kills, so no process outlives the test file.
const killLeftovers = () => {
  for (const pid of pids()) if (alive(pid)) process.kill(pid, "SIGKILL");
  for (const f of readdirSync(dir)) if (f.startsWith("pid-") || f.endsWith(".json")) rmSync(join(dir, f));
};
afterEach(killLeftovers);
afterAll(() => {
  killLeftovers();
  rmSync(dir, { recursive: true, force: true });
});

/** The harness's setup path for the two instances, with the stand-in script. */
async function run(
  modes: Record<string, "ok" | "exit" | "never" | "ignore-term">,
  o: {
    startTimeoutMs?: number;
    termGraceMs?: number;
    cleanupTimeoutMs?: number;
    signal?: AbortSignal;
    extraCleanup?: () => Promise<void>;
  } = {},
) {
  const out = join(dir, `report-${Date.now()}.json`);
  const t0 = Date.now();
  const result = await runMeasurement({
    out,
    meta: {},
    ...(o.signal ? { signal: o.signal } : {}),
    limits: { cleanupTimeoutMs: o.cleanupTimeoutMs ?? 10_000, runDeadlineMs: 30_000 },
    setup: async ({ onCleanup, report }) => {
      if (o.extraCleanup) onCleanup(o.extraCleanup);
      await startInstances(["i1", "i2"], {
        bin,
        env: (name) => ({
          PATH: process.env.PATH ?? "",
          AIMEM_INSTANCE: name,
          STANDIN_DIR: dir,
          [`STANDIN_${name}`]: modes[name] ?? "ok",
        }),
        onCleanup,
        report,
        ...(o.startTimeoutMs !== undefined ? { startTimeoutMs: o.startTimeoutMs } : {}),
        ...(o.termGraceMs !== undefined ? { termGraceMs: o.termGraceMs } : {}),
      });
      return [];
    },
  });
  // Checked at once: nothing may still be running when the harness has returned.
  const left = pids().filter(alive);
  return { ...result, left, ms: Date.now() - t0, out, started: pids().length };
}

describe("no server process outlives the harness (QA 6.1b P3 recheck)", () => {
  it("instance 2 exits while starting: instance 1 is stopped too", async () => {
    const r = await run({ i2: "exit" });
    expect(r.started).toBe(2);
    expect(r.verdict.reasons[0]).toMatch(/run stopped: instance i2 exited/);
    expect(r.left).toEqual([]);
    expect(existsSync(r.out)).toBe(true);
  });

  it("instance 2 never gets ready: both are stopped", async () => {
    const r = await run({ i2: "never" }, { startTimeoutMs: 500 });
    expect(r.started).toBe(2);
    expect(r.verdict.reasons[0]).toMatch(/did not start within 500 ms/);
    expect(r.left).toEqual([]);
    expect(existsSync(r.out)).toBe(true);
  });

  it("the run is stopped (SIGTERM path) while the instances start: both are stopped", async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(new Error("stopped by SIGTERM")), 400);
    const r = await run({ i1: "never", i2: "never" }, { startTimeoutMs: 20_000, signal: stop.signal });
    expect(r.ms).toBeLessThan(10_000);
    expect(r.verdict.reasons[0]).toMatch(/stopped by SIGTERM/);
    expect(r.started).toBeGreaterThanOrEqual(1);
    expect(r.left).toEqual([]);
    expect(existsSync(r.out)).toBe(true);
  });

  // As with the defaults (5 s grace, 10 s per teardown step): stopping one after the other does not fit the step.
  it("instances that ignore SIGTERM are killed and have ended when the harness returns", async () => {
    const r = await run(
      { i1: "ignore-term", i2: "ignore-term" },
      { termGraceMs: 400, cleanupTimeoutMs: 700 },
    );
    expect(r.started).toBe(2);
    expect(r.left).toEqual([]);
    expect(r.verdict.reasons.join()).not.toMatch(/teardown/);
  });

  it("a teardown step that does not finish makes the run not valid, never a success", async () => {
    const r = await run(
      {},
      { cleanupTimeoutMs: 200, extraCleanup: () => new Promise<void>(() => undefined) /* never ends */ },
    );
    expect(r.left).toEqual([]);
    expect(r.verdict.result).toBe("not valid");
    expect(r.verdict.reasons.join()).toMatch(/teardown step 1 did not finish within 200 ms/);
    expect(existsSync(r.out)).toBe(true);
  });
});
