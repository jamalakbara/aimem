/**
 * Server processes of the claim-visibility harness (plan 6.1 §8): start, register for teardown, stop. Apart from
 * claim-visibility.ts so local tests can drive it with a small stand-in server instead of the real one.
 */
import { type ChildProcess, spawn } from "node:child_process";

export interface Instance {
  name: string;
  url: string;
  port: number;
  proc: ChildProcess;
  log: string[];
}

export interface InstanceOptions {
  /** The server script; it prints `listening on http://127.0.0.1:<port> as <name>` when ready. */
  bin: string;
  env(name: string): NodeJS.ProcessEnv;
  onCleanup(fn: () => Promise<void> | void): void;
  report: Record<string, unknown>;
  /** Without its "listening" line in time, an instance is killed (QA 6.1b P3). */
  startTimeoutMs?: number;
  /** Time between SIGTERM and SIGKILL when stopping. */
  termGraceMs?: number;
}

export const START_TIMEOUT_MS = 30_000;
export const TERM_GRACE_MS = 5_000;

function startInstance(name: string, o: InstanceOptions): Promise<Instance> {
  const startTimeoutMs = o.startTimeoutMs ?? START_TIMEOUT_MS;
  const proc = spawn(process.execPath, [o.bin, "serve", "--port", "0"], {
    env: o.env(name),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log: string[] = [];
  return new Promise((done, fail) => {
    let out = "";
    proc.stderr?.on("data", (d) => log.push(String(d).trim()));
    proc.stdout?.on("data", (d) => {
      out += d;
      const m = /listening on (http:\/\/127\.0\.0\.1:(\d+)) as (\S+)/.exec(out);
      if (m?.[1] && m[3] === name) {
        log.push(`listening as ${m[3]}`);
        done({ name, url: m[1], port: Number(m[2]), proc, log });
      }
    });
    proc.on("exit", (c) => fail(new Error(`instance ${name} exited with ${c}`)));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      fail(new Error(`instance ${name} did not start within ${startTimeoutMs} ms`));
    }, startTimeoutMs);
    proc.once("exit", () => clearTimeout(timer));
    proc.stdout?.on("data", () => {
      if (/listening on/.test(out)) clearTimeout(timer);
    });
  });
}

const stopInstance = (i: Instance, graceMs: number) =>
  new Promise<void>((done) => {
    if (i.proc.exitCode !== null) return done();
    i.proc.once("exit", () => done());
    i.proc.kill("SIGTERM");
    // An instance that does not stop within the grace time is killed, so teardown always ends.
    setTimeout(() => i.proc.exitCode === null && i.proc.kill("SIGKILL"), graceMs).unref();
  });

/** Starts the named instances in order and registers their teardown. */
export async function startInstances(names: readonly string[], o: InstanceOptions): Promise<Instance[]> {
  const instances: Instance[] = [];
  o.report.instanceLogs = {};
  o.onCleanup(async () => {
    for (const i of instances) await stopInstance(i, o.termGraceMs ?? TERM_GRACE_MS);
    o.report.instanceLogs = Object.fromEntries(instances.map((i) => [i.name, i.log]));
  });
  const started: Instance[] = [];
  for (const name of names) started.push(await startInstance(name, o));
  instances.push(...started);
  return instances;
}
