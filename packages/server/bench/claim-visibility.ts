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
import { arch, cpus, platform, release } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPool, createToken, migrate } from "../dist/index.js";
import { startLatencyProxy } from "./latency-proxy.ts";
import { runMeasurement } from "./measure.ts";
import { PROXY_DELAY_MS, summarize } from "./stats.ts";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

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
  const instances: Instance[] = [];
  const { verdict: v, report } = await runMeasurement({
    out,
    meta: {
      kind: "aimem claim visibility (plan 6.1 §8)",
      label: "simulation on one machine; not a LAN or internet measurement",
      sha: gitSha(),
      runner: {
        name: process.env.RUNNER_NAME ?? null,
        os: `${platform()} ${release()} ${arch()}`,
        cpus: cpus().length,
      },
      node: process.version,
      postgres: null,
      proxyDelayMs: PROXY_DELAY_MS,
    },
    setup: async ({ onCleanup, report }) => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error("DATABASE_URL is not set");
      const pool = createPool(databaseUrl, 2);
      pool.on("error", () => undefined);
      onCleanup(() => pool.end());
      report.postgres = String((await pool.query("SELECT version() AS v")).rows[0].v);
      await migrate(pool);
      const slug = `bench-${Date.now().toString(36)}`;
      const writer = (
        await createToken(pool, { project: slug, user: "bench-a", kind: "human", scopes: ["write:live"] })
      ).token;
      const reader = (
        await createToken(pool, { project: slug, user: "bench-b", kind: "human", scopes: ["read"] })
      ).token;
      report.instanceLogs = {};
      onCleanup(async () => {
        for (const i of instances) await stopInstance(i);
        report.instanceLogs = Object.fromEntries(instances.map((i) => [i.name, i.log]));
      });
      instances.push(await startInstance("i1", databaseUrl), await startInstance("i2", databaseUrl));
      const [i1, i2] = instances as [Instance, Instance];
      const proxyA = await startLatencyProxy({ targetPort: i1.port, delayMs: PROXY_DELAY_MS });
      onCleanup(proxyA.close);
      const proxyB = await startLatencyProxy({ targetPort: i2.port, delayMs: PROXY_DELAY_MS });
      onCleanup(proxyB.close);
      const viaA = `http://127.0.0.1:${proxyA.port}`;
      const common = { slug, writer, reader };
      return [
        { ...common, name: "same-instance", a: { base: i1.url, expected: "i1" }, b: { base: i1.url, expected: "i1" } },
        { ...common, name: "two-instances", a: { base: i1.url, expected: "i1" }, b: { base: i2.url, expected: "i2" } },
        {
          ...common,
          name: "two-instances-proxied",
          a: { base: viaA, expected: "i1" },
          b: { base: `http://127.0.0.1:${proxyB.port}`, expected: "i2" },
          rttBase: viaA,
        },
      ];
    },
  });
  for (const p of report.profiles as { name: string; samples: number[]; rttMs?: number[] }[]) {
    const s = summarize(p.samples);
    process.stdout.write(
      `${p.name}: n=${s.n} p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} p99=${s.p99.toFixed(1)} max=${s.max.toFixed(1)} ms` +
        `${p.rttMs?.length ? ` rtt min=${Math.min(...p.rttMs).toFixed(1)} ms` : ""}\n`,
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
