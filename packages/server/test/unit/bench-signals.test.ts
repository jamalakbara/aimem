import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * A stop signal sent again while the harness tears down must not cut the teardown (QA 6.1b final review, R1).
 * A small driver runs the harness's own pieces (stopOnSignals, runMeasurement, startInstances) in a child
 * process, with stand-in servers that ignore SIGTERM, so teardown has to wait and then kill them. Every step
 * waits for something it can see (a line, a file), not for a fixed time. Windows has no catchable SIGTERM.
 */
const STAND_IN = `
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
const name = process.env.AIMEM_INSTANCE;
writeFileSync(process.env.STANDIN_DIR + "/pid-" + name + "-" + process.pid, "");
process.on("SIGTERM", () => writeFileSync(process.env.STANDIN_DIR + "/term-" + name, ""));
const s = createServer((_q, r) => r.end("{}"));
s.listen(0, "127.0.0.1", () =>
  process.stdout.write("aimem server listening on http://127.0.0.1:" + s.address().port + " as " + name + "\\n"),
);
`;
const bench = (f: string) => fileURLToPath(new URL(`../../bench/${f}`, import.meta.url));
const DRIVER = (standIn: string, dir: string) => `
import { startInstances } from ${JSON.stringify(bench("instances.ts"))};
import { runMeasurement } from ${JSON.stringify(bench("measure.ts"))};
import { stopOnSignals } from ${JSON.stringify(bench("signals.ts"))};
const stops = stopOnSignals();
const { verdict } = await runMeasurement({
  out: process.env.OUT,
  meta: {},
  signal: stops.signal,
  limits: { cleanupTimeoutMs: 10000, runDeadlineMs: 60000 },
  setup: async ({ onCleanup, report, signal }) => {
    await startInstances(["i1", "i2"], {
      bin: ${JSON.stringify(standIn)},
      env: (name) => ({ PATH: process.env.PATH ?? "", AIMEM_INSTANCE: name, STANDIN_DIR: ${JSON.stringify(dir)} }),
      onCleanup,
      report,
      signal,
      termGraceMs: 1500,
    });
    process.stdout.write("instances ready\\n");
    await new Promise(() => undefined); // the run ends only by a signal
    return [];
  },
});
stops.dispose();
process.exit(verdict.result === "passed in simulation" ? 0 : 1);
`;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-signals-"));
  writeFileSync(join(dir, "stand-in.mjs"), STAND_IN);
  writeFileSync(join(dir, "driver.mjs"), DRIVER(join(dir, "stand-in.mjs"), dir));
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
const children: { kill(s: NodeJS.Signals): boolean; exitCode: number | null; signalCode: string | null }[] =
  [];
// Fallback cleanup: the test kills whatever the harness left, so nothing outlives the file.
const killLeftovers = () => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const pid of pids()) if (alive(pid)) process.kill(pid, "SIGKILL");
  for (const f of readdirSync(dir)) if (/^(pid-|term-|report)/.test(f)) rmSync(join(dir, f));
};
afterEach(killLeftovers);
afterAll(() => {
  killLeftovers();
  rmSync(dir, { recursive: true, force: true });
});

/** Waits until `pred` holds, checking every 20 ms, for at most `ms`. */
async function until(pred: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((d) => setTimeout(d, 20));
  }
}

async function twice(first: NodeJS.Signals, second: NodeJS.Signals) {
  const out = join(dir, "report.json");
  const child = spawn(process.execPath, [join(dir, "driver.mjs")], {
    env: { PATH: process.env.PATH ?? "", OUT: out },
    stdio: ["ignore", "pipe", "ignore"],
  });
  children.push(child);
  let stdout = "";
  child.stdout.on("data", (d) => {
    stdout += d;
  });
  const exited = new Promise<number | null>((d) => child.once("exit", (c) => d(c)));
  // Ready: both instances started and the handlers are in place (they are set up before the run starts).
  await until(() => stdout.includes("instances ready"), 30_000, "both instances");
  child.kill(first);
  // Teardown has begun: both stand-ins got their SIGTERM (and ignore it); the kill comes 1.5 s later.
  await until(() => existsSync(join(dir, "term-i1")) && existsSync(join(dir, "term-i2")), 15_000, "teardown");
  child.kill(second);
  const code = await exited;
  const left = pids().filter(alive);
  return { code, left, out, started: pids().length };
}

describe.skipIf(process.platform === "win32")("a second stop signal during teardown (QA 6.1b R1)", () => {
  for (const [first, second] of [
    ["SIGTERM", "SIGTERM"],
    ["SIGINT", "SIGINT"],
  ] as const)
    it(`${first} then ${second}: teardown finishes, the report is written, no process is left`, async () => {
      const r = await twice(first, second);
      expect(r.started).toBe(2);
      // One check for the three outcomes, so a failure shows all of them.
      expect({ exit: r.code, leftProcesses: r.left.length, report: existsSync(r.out) }).toEqual({
        exit: 1,
        leftProcesses: 0,
        report: true,
      });
      const report = JSON.parse(readFileSync(r.out, "utf8"));
      expect(report.verdict.result).toBe("not valid");
      expect(report.verdict.reasons[0]).toMatch(new RegExp(`stopped by ${first}`));
      expect(report.teardown).toEqual([]);
    });
});
