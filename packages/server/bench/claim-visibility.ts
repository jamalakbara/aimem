/**
 * Claim visibility, p95 (plan 6.1 §8, QA W11, P95-1). Run only by the CI job `p95` against its PostgreSQL:
 *
 *   DATABASE_URL=… node packages/server/bench/claim-visibility.ts --out p95-report.json
 *
 * Two server processes (instances i1 and i2) are started from the build. Client A claims a new task with a fresh
 * connection each sample; client B listens on one SSE stream. A sample is the time from A starting to send until
 * B has received the `claim.created` of that task and holder. Three profiles: same instance; two instances; two
 * instances with both paths through a proxy that delays each chunk 50 ms. The JSON report is written also when the
 * run fails or stops. The verdict is at best "passed in simulation"; it says nothing about a LAN or the internet.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { arch, cpus, platform, release } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPool, createToken, migrate } from "../dist/index.js";
import { openStream, type SseEvent, type SseStream } from "../test/sse-client.ts";
import { startLatencyProxy } from "./latency-proxy.ts";
import {
  type Failure,
  MEASURED,
  PROXY_DELAY_MS,
  type ProfileName,
  type ProfileResult,
  problems,
  SAMPLE_TIMEOUT_MS,
  summarize,
  verdict,
  WARMUP,
} from "./stats.ts";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const HOLDER = "human:bench-a";
const MAX_FAILURES = 10;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const newTask = () => `tsk-${[...randomBytes(8)].map((b) => ALPHABET[b % 32]).join("")}`;

interface Instance {
  name: string;
  url: string;
  port: number;
  proc: ChildProcess;
  log: string[];
}

function startInstance(name: string, databaseUrl: string): Promise<Instance> {
  const proc = spawn(process.execPath, [BIN, "serve", "--port", "0"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl, AIMEM_INSTANCE: name },
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
  });
}

const stopInstance = (i: Instance) =>
  new Promise<void>((done) => {
    if (i.proc.exitCode !== null) return done();
    i.proc.once("exit", () => done());
    i.proc.kill("SIGTERM");
  });

/** One request on its own connection (no keep-alive, plan §8). */
function send(
  base: string,
  o: { method: string; path: string; token?: string; body?: unknown },
): Promise<{ status: number; instance: string }> {
  return new Promise((done, fail) => {
    const url = new URL(o.path, base);
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: o.method,
        agent: false,
        headers: {
          Connection: "close",
          ...(o.token ? { Authorization: `Bearer ${o.token}`, "Aimem-Session": "bench-a" } : {}),
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          done({ status: res.statusCode ?? 0, instance: String(res.headers["aimem-instance"] ?? "") }),
        );
      },
    );
    req.on("error", fail);
    req.end(body);
  });
}

async function runProfile(o: {
  name: ProfileName;
  slug: string;
  writer: string;
  reader: string;
  a: { base: string; expected: string };
  b: { base: string; expected: string };
  rttBase?: string;
}): Promise<ProfileResult> {
  const result: ProfileResult = {
    name: o.name,
    instances: { a: [], b: "" },
    expected: { a: o.a.expected, b: o.b.expected },
    warmup: [],
    samples: [],
    failures: [],
  };
  if (o.rttBase) {
    // The validity control before profile 3: a round trip through the proxy must take ≥ 100 ms.
    result.rttMs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await send(o.rttBase, { method: "GET", path: "/healthz" });
      result.rttMs.push(performance.now() - t0);
    }
  }
  const stream: SseStream = await openStream(o.b.base, `/v1/projects/${o.slug}/events`, { token: o.reader });
  result.instances.b = String(stream.headers["aimem-instance"] ?? "");
  if (stream.status !== 200) {
    result.failures.push({ kind: "error", sample: -1, detail: `stream answered ${stream.status}` });
    return result;
  }
  const tasks: string[] = [];
  try {
    for (let i = 0; i < WARMUP + MEASURED && result.failures.length < MAX_FAILURES; i++) {
      const task = `${o.slug}:${newTask()}`;
      tasks.push(task);
      const match = (e: SseEvent) =>
        e.event === "claim.created" && e.data?.claim?.task === task && e.data?.claim?.holder === HOLDER;
      const t0 = performance.now();
      let r: { status: number; instance: string };
      try {
        r = await send(o.a.base, {
          method: "POST",
          path: `/v1/projects/${o.slug}/claims`,
          token: o.writer,
          body: { task },
        });
      } catch (e) {
        result.failures.push({ kind: "error", sample: i, detail: `POST failed: ${(e as Error).message}` });
        continue;
      }
      result.instances.a.push(r.instance);
      if (r.status !== 201) {
        result.failures.push({ kind: "status", sample: i, detail: `POST answered ${r.status}` });
        continue;
      }
      const left = SAMPLE_TIMEOUT_MS - (performance.now() - t0);
      let event: SseEvent | undefined;
      try {
        const seen = await stream.waitFor((list) => list.some(match), Math.max(1, left), task);
        event = seen.find(match);
      } catch {
        const f: Failure = stream.isEnded()
          ? { kind: "missing", sample: i, detail: "the stream ended before the event" }
          : { kind: "timeout", sample: i, detail: `no event within ${SAMPLE_TIMEOUT_MS} ms` };
        result.failures.push(f);
        if (stream.isEnded()) break;
        continue;
      }
      const ms = (event as SseEvent).receivedAt - t0;
      (i < WARMUP ? result.warmup : result.samples).push(ms);
    }
    // Late duplicates: give the stream a moment, then every task must have arrived exactly once.
    await new Promise((d) => setTimeout(d, 500));
    const counts = new Map<string, number>();
    for (const e of stream.events)
      if (e.event === "claim.created" && e.data?.claim?.holder === HOLDER)
        counts.set(e.data.claim.task, (counts.get(e.data.claim.task) ?? 0) + 1);
    tasks.forEach((t, i) => {
      if ((counts.get(t) ?? 0) > 1)
        result.failures.push({ kind: "duplicate", sample: i, detail: `${counts.get(t)} events for one claim` });
    });
  } finally {
    stream.close();
  }
  return result;
}

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { out: { type: "string", default: "p95-report.json" } } });
  const out = values.out as string;
  const results: ProfileResult[] = [];
  const report: Record<string, unknown> = {
    kind: "aimem claim visibility (plan 6.1 §8)",
    label: "simulation on one machine; not a LAN or internet measurement",
    sha: gitSha(),
    runner: {
      name: process.env.RUNNER_NAME ?? null,
      os: `${platform()} ${release()} ${arch()}`,
      cpus: cpus().length,
    },
    node: process.version,
    postgres: null as string | null,
    proxyDelayMs: PROXY_DELAY_MS,
    startedAt: new Date().toISOString(),
    profiles: [] as unknown[],
  };
  const instances: Instance[] = [];
  const closers: (() => Promise<void>)[] = [];
  let error: string | undefined;
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");
    const pool = createPool(databaseUrl, 2);
    pool.on("error", () => undefined);
    closers.push(() => pool.end());
    report.postgres = String((await pool.query("SELECT version() AS v")).rows[0].v);
    await migrate(pool);
    const slug = `bench-${Date.now().toString(36)}`;
    const writer = (
      await createToken(pool, { project: slug, user: "bench-a", kind: "human", scopes: ["write:live"] })
    ).token;
    const reader = (await createToken(pool, { project: slug, user: "bench-b", kind: "human", scopes: ["read"] }))
      .token;
    instances.push(await startInstance("i1", databaseUrl), await startInstance("i2", databaseUrl));
    const [i1, i2] = instances as [Instance, Instance];
    results.push(
      await runProfile({
        name: "same-instance",
        slug,
        writer,
        reader,
        a: { base: i1.url, expected: "i1" },
        b: { base: i1.url, expected: "i1" },
      }),
    );
    results.push(
      await runProfile({
        name: "two-instances",
        slug,
        writer,
        reader,
        a: { base: i1.url, expected: "i1" },
        b: { base: i2.url, expected: "i2" },
      }),
    );
    const proxyA = await startLatencyProxy({ targetPort: i1.port, delayMs: PROXY_DELAY_MS });
    const proxyB = await startLatencyProxy({ targetPort: i2.port, delayMs: PROXY_DELAY_MS });
    closers.push(proxyA.close, proxyB.close);
    const viaA = `http://127.0.0.1:${proxyA.port}`;
    results.push(
      await runProfile({
        name: "two-instances-proxied",
        slug,
        writer,
        reader,
        a: { base: viaA, expected: "i1" },
        b: { base: `http://127.0.0.1:${proxyB.port}`, expected: "i2" },
        rttBase: viaA,
      }),
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    for (const i of instances) await stopInstance(i);
    for (const c of closers.reverse()) await c().catch(() => undefined);
  }
  report.profiles = results.map((r) => ({
    ...r,
    stats: summarize(r.samples),
    warmupStats: summarize(r.warmup),
    problems: problems(r),
  }));
  report.instanceLogs = Object.fromEntries(instances.map((i) => [i.name, i.log]));
  report.finishedAt = new Date().toISOString();
  const v = verdict(results, error);
  report.verdict = v;
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const r of results) {
    const s = summarize(r.samples);
    process.stdout.write(
      `${r.name}: n=${s.n} p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} p99=${s.p99.toFixed(1)} max=${s.max.toFixed(1)} ms` +
        `${r.rttMs ? ` rtt min=${Math.min(...r.rttMs).toFixed(1)} ms` : ""}\n`,
    );
  }
  process.stdout.write(`verdict: ${v.result}\n${v.reasons.map((x) => `  - ${x}\n`).join("")}report: ${out}\n`);
  return v.result === "passed in simulation" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`claim-visibility crashed: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
