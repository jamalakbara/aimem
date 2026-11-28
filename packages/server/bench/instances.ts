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

/** After SIGKILL, how long the harness waits for the exit before it reports the teardown as failed. */
export const KILL_WAIT_MS = 2_000;

const ended = (proc: ChildProcess) => proc.exitCode !== null || proc.signalCode !== null;

/**
 * Starts one instance. The child is handed to `register` right after `spawn`, before it is ready, so teardown
 * covers it whatever happens next (QA 6.1b P3 recheck).
 */
function startInstance(
  name: string,
  o: InstanceOptions,
  register: (s: Spawned) => void,
): Promise<Instance> {
  const startTimeoutMs = o.startTimeoutMs ?? START_TIMEOUT_MS;
  const proc = spawn(process.execPath, [o.bin, "serve", "--port", "0"], {
    env: o.env(name),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log: string[] = [];
  register({ name, proc, log });
  return new Promise((done, fail) => {
    let out = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      fail(new Error(`instance ${name} did not start within ${startTimeoutMs} ms`));
    }, startTimeoutMs);
    proc.stderr?.on("data", (d) => log.push(String(d).trim()));
    proc.stdout?.on("data", (d) => {
      out += d;
      const m = /listening on (http:\/\/127\.0\.0\.1:(\d+)) as (\S+)/.exec(out);
      if (m?.[1] && m[3] === name) {
        clearTimeout(timer);
        log.push(`listening as ${m[3]}`);
        done({ name, url: m[1], port: Number(m[2]), proc, log });
      }
    });
    proc.once("exit", (c, sig) => {
      clearTimeout(timer);
      fail(new Error(`instance ${name} exited with ${c ?? sig}`));
    });
    proc.once("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
  });
}

interface Spawned {
  name: string;
  proc: ChildProcess;
  log: string[];
}

/**
 * Stops one child: SIGTERM, then SIGKILL after the grace time, and waits for its exit. A child that has not ended
 * shortly after SIGKILL makes the teardown fail, so a run never reports success with a server still running.
 */
function stopChild(s: Spawned, graceMs: number): Promise<void> {
  return new Promise<void>((done, fail) => {
    if (ended(s.proc)) return done();
    let kill: NodeJS.Timeout | undefined;
    let give: NodeJS.Timeout | undefined;
    s.proc.once("exit", () => {
      clearTimeout(kill);
      clearTimeout(give);
      done();
    });
    s.proc.kill("SIGTERM");
    kill = setTimeout(() => {
      if (ended(s.proc)) return;
      s.proc.kill("SIGKILL");
      give = setTimeout(
        () => fail(new Error(`instance ${s.name} (pid ${s.proc.pid}) did not end after SIGKILL`)),
        KILL_WAIT_MS,
      );
    }, graceMs);
  });
}

/**
 * Starts the named instances in order. Teardown is registered before the first start and covers every child that
 * was spawned, ready or not; children are stopped at the same time. After `signal` aborts or teardown has begun,
 * no further child is started.
 */
export async function startInstances(
  names: readonly string[],
  o: InstanceOptions & { signal?: AbortSignal },
): Promise<Instance[]> {
  const spawned: Spawned[] = [];
  let tornDown = false;
  o.report.instanceLogs = {};
  o.onCleanup(async () => {
    tornDown = true;
    const results = await Promise.allSettled(spawned.map((s) => stopChild(s, o.termGraceMs ?? TERM_GRACE_MS)));
    o.report.instanceLogs = Object.fromEntries(spawned.map((s) => [s.name, s.log]));
    const failed = results.flatMap((r) => (r.status === "rejected" ? [(r.reason as Error).message] : []));
    if (failed.length) throw new Error(failed.join("; "));
  });
  const instances: Instance[] = [];
  for (const name of names) {
    if (tornDown || o.signal?.aborted) throw new Error(`instance ${name} not started: the run was stopped`);
    instances.push(await startInstance(name, o, (s) => spawned.push(s)));
  }
  return instances;
}
