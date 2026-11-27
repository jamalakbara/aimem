/**
 * The measuring part of the claim-visibility harness (plan 6.1 §8), apart from the database setup in
 * claim-visibility.ts, so that it runs against stand-in servers in local tests.
 */
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { openStream, type SseEvent, type SseStream } from "../test/sse-client.ts";
import {
  type Failure,
  MEASURED,
  type ProfileName,
  type ProfileResult,
  problems,
  SAMPLE_TIMEOUT_MS,
  summarize,
  type Verdict,
  verdict,
  WARMUP,
} from "./stats.ts";

export const HOLDER = "human:bench-a";
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const newTask = () => `tsk-${[...randomBytes(8)].map((b) => ALPHABET[b % 32]).join("")}`;

/** One profile: where A posts, where B listens, and (profile 3) where the round trip is measured. */
export interface ProfileSpec {
  name: ProfileName;
  slug: string;
  writer: string;
  reader: string;
  a: { base: string; expected: string };
  b: { base: string; expected: string };
  rttBase?: string;
}

export interface Limits {
  warmup: number;
  measured: number;
  sampleTimeoutMs: number;
  /** A profile stops after this many failures; the run has failed by then anyway. */
  maxFailures: number;
}
export const DEFAULT_LIMITS: Limits = {
  warmup: WARMUP,
  measured: MEASURED,
  sampleTimeoutMs: SAMPLE_TIMEOUT_MS,
  maxFailures: 10,
};

/** One request on its own connection (no keep-alive, plan §8). */
export function send(
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

export async function runProfile(o: ProfileSpec, limits: Partial<Limits> = {}): Promise<ProfileResult> {
  const L = { ...DEFAULT_LIMITS, ...limits };
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
    for (let i = 0; i < L.warmup + L.measured && result.failures.length < L.maxFailures; i++) {
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
      const left = L.sampleTimeoutMs - (performance.now() - t0);
      let event: SseEvent | undefined;
      try {
        const seen = await stream.waitFor((list) => list.some(match), Math.max(1, left), task);
        event = seen.find(match);
      } catch {
        const f: Failure = stream.isEnded()
          ? { kind: "missing", sample: i, detail: "the stream ended before the event" }
          : { kind: "timeout", sample: i, detail: `no event within ${L.sampleTimeoutMs} ms` };
        result.failures.push(f);
        if (stream.isEnded()) break;
        continue;
      }
      const ms = (event as SseEvent).receivedAt - t0;
      (i < L.warmup ? result.warmup : result.samples).push(ms);
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


export interface MeasureOptions {
  out: string;
  /** Report fields that describe the run (SHA, runner, versions). */
  meta: Record<string, unknown>;
  /** Starts what the profiles need; `onCleanup` registers teardown, run in reverse order. */
  setup(ctx: { onCleanup(fn: () => Promise<void> | void): void; report: Record<string, unknown> }): Promise<ProfileSpec[]>;
  limits?: Partial<Limits>;
}

/** Runs every profile, tears everything down, writes the JSON report, and returns the verdict. */
export async function runMeasurement(o: MeasureOptions): Promise<{ verdict: Verdict; report: Record<string, unknown> }> {
  const L = { ...DEFAULT_LIMITS, ...o.limits };
  const results: ProfileResult[] = [];
  const report: Record<string, unknown> = { ...o.meta, startedAt: new Date().toISOString(), profiles: [] };
  const cleanups: (() => Promise<void> | void)[] = [];
  let error: string | undefined;
  try {
    const specs = await o.setup({ onCleanup: (fn) => cleanups.push(fn), report });
    for (const spec of specs) results.push(await runProfile(spec, L));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    for (const c of cleanups.reverse()) await Promise.resolve().then(c).catch(() => undefined);
  }
  const counts = { warmup: L.warmup, measured: L.measured };
  report.profiles = results.map((r) => ({
    ...r,
    stats: summarize(r.samples),
    warmupStats: summarize(r.warmup),
    problems: problems(r, counts),
  }));
  report.finishedAt = new Date().toISOString();
  const v = verdict(results, error, counts);
  report.verdict = v;
  writeFileSync(o.out, `${JSON.stringify(report, null, 2)}\n`);
  return { verdict: v, report };
}
