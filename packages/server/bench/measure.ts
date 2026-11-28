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
  INVALID,
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
  /** Each round trip and the opening of the stream. */
  stepTimeoutMs: number;
  /** The whole run, setup and teardown included; the report is written when it passes. */
  runDeadlineMs: number;
  /** Each teardown step. */
  cleanupTimeoutMs: number;
}
export const DEFAULT_LIMITS: Limits = {
  warmup: WARMUP,
  measured: MEASURED,
  sampleTimeoutMs: SAMPLE_TIMEOUT_MS,
  maxFailures: 10,
  stepTimeoutMs: 10_000,
  runDeadlineMs: 20 * 60_000,
  cleanupTimeoutMs: 10_000,
};

/** A wait that ran out; reported as a `timeout` failure. */
export class TimedOut extends Error {}

/**
 * One request on its own connection (no keep-alive, plan §8). Without a whole answer within `timeoutMs`, the
 * request is dropped and the promise fails with `TimedOut` (QA 6.1b P3).
 */
export function send(
  base: string,
  o: { method: string; path: string; token?: string; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; instance: string }> {
  return new Promise((done, fail) => {
    const url = new URL(o.path, base);
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    let timer: NodeJS.Timeout | undefined;
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
        res.on("end", () => {
          clearTimeout(timer);
          done({ status: res.statusCode ?? 0, instance: String(res.headers["aimem-instance"] ?? "") });
        });
        res.on("error", (e) => {
          clearTimeout(timer);
          fail(e);
        });
      },
    );
    if (o.timeoutMs !== undefined)
      timer = setTimeout(
        () => req.destroy(new TimedOut(`no answer within ${Math.round(o.timeoutMs ?? 0)} ms`)),
        Math.max(1, o.timeoutMs),
      );
    req.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    req.end(body);
  });
}

export const newResult = (o: ProfileSpec): ProfileResult => ({
  name: o.name,
  instances: { a: [], b: "" },
  expected: { a: o.a.expected, b: o.b.expected },
  warmup: [],
  samples: [],
  failures: [],
});

/**
 * One profile, filling `result` as it goes so a run stopped by its deadline still reports what it had. Every wait
 * is bounded: round trips and the stream opening by `stepTimeoutMs`, each sample by one `sampleTimeoutMs` from
 * the moment A starts to send until B has the event (QA 6.1b P2, P3).
 */
export async function runProfile(
  o: ProfileSpec,
  limits: Partial<Limits> = {},
  result: ProfileResult = newResult(o),
  signal?: AbortSignal,
  onStream?: (s: SseStream) => void,
): Promise<ProfileResult> {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const stopped = () => signal?.aborted === true;
  if (o.rttBase) {
    // The validity control before profile 3: a round trip through the proxy must take ≥ 100 ms.
    result.rttMs = [];
    for (let i = 0; i < 5 && !stopped(); i++) {
      const t0 = performance.now();
      try {
        await send(o.rttBase, { method: "GET", path: "/healthz", timeoutMs: L.stepTimeoutMs });
      } catch (e) {
        result.failures.push({ kind: "error", sample: -1, detail: `round trip: ${(e as Error).message}` });
        return result;
      }
      result.rttMs.push(performance.now() - t0);
    }
  }
  if (stopped()) return result;
  let stream: SseStream;
  try {
    stream = await openStream(o.b.base, `/v1/projects/${o.slug}/events`, {
      token: o.reader,
      timeoutMs: L.stepTimeoutMs,
    });
  } catch (e) {
    result.failures.push({ kind: "error", sample: -1, detail: `stream did not open: ${(e as Error).message}` });
    return result;
  }
  onStream?.(stream);
  result.instances.b = String(stream.headers["aimem-instance"] ?? "");
  if (stream.status !== 200) {
    stream.close();
    result.failures.push({ kind: "error", sample: -1, detail: `stream answered ${stream.status}` });
    return result;
  }
  const tasks: string[] = [];
  try {
    for (let i = 0; i < L.warmup + L.measured && result.failures.length < L.maxFailures && !stopped(); i++) {
      const task = `${o.slug}:${newTask()}`;
      tasks.push(task);
      const match = (e: SseEvent) =>
        e.event === "claim.created" && e.data?.claim?.task === task && e.data?.claim?.holder === HOLDER;
      const t0 = performance.now();
      const left = () => L.sampleTimeoutMs - (performance.now() - t0);
      const late = (what: string): Failure => ({
        kind: "timeout",
        sample: i,
        detail: `${what} within ${L.sampleTimeoutMs} ms of sending the POST`,
      });
      let r: { status: number; instance: string };
      try {
        r = await send(o.a.base, {
          method: "POST",
          path: `/v1/projects/${o.slug}/claims`,
          token: o.writer,
          body: { task },
          timeoutMs: left(),
        });
      } catch (e) {
        result.failures.push(
          e instanceof TimedOut
            ? late("no answer to the POST")
            : { kind: "error", sample: i, detail: `POST failed: ${(e as Error).message}` },
        );
        continue;
      }
      result.instances.a.push(r.instance);
      if (r.status !== 201) {
        result.failures.push({ kind: "status", sample: i, detail: `POST answered ${r.status}` });
        continue;
      }
      // The POST answer itself must come within the same limit, even when the event was already there.
      if (left() < 0) {
        result.failures.push(late("the POST was answered after the limit, not"));
        continue;
      }
      let event: SseEvent | undefined;
      try {
        const seen = await stream.waitFor((list) => list.some(match), Math.max(1, left()), task);
        event = seen.find(match);
      } catch {
        if (stream.isEnded()) {
          result.failures.push({ kind: "missing", sample: i, detail: "the stream ended before the event" });
          break;
        }
        result.failures.push(late("no event"));
        continue;
      }
      const ms = (event as SseEvent).receivedAt - t0;
      if (ms > L.sampleTimeoutMs) {
        result.failures.push(late("the event did not arrive"));
        continue;
      }
      (i < L.warmup ? result.warmup : result.samples).push(ms);
    }
    if (!stopped()) {
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
    }
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
  setup(ctx: {
    onCleanup(fn: () => Promise<void> | void): void;
    report: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<ProfileSpec[]>;
  limits?: Partial<Limits>;
  /** Stops the run like its deadline does (SIGTERM in claim-visibility.ts). */
  signal?: AbortSignal;
}

/** Settles like `p`, or rejects with the abort reason when `signal` aborts first. */
const untilAborted = <T>(p: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((done, fail) => {
    if (signal.aborted) return fail(signal.reason);
    const stop = () => fail(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", stop);
        done(v);
      },
      (e) => {
        signal.removeEventListener("abort", stop);
        fail(e);
      },
    );
  });

/**
 * Runs every profile, tears everything down, writes the JSON report, and returns the verdict. The whole run has a
 * deadline; when it passes (or `signal` aborts), the run stops, every cleanup still runs (each bounded), and the
 * report is written with what was measured so far (QA 6.1b P3).
 */
export async function runMeasurement(
  o: MeasureOptions,
): Promise<{ verdict: Verdict; report: Record<string, unknown> }> {
  const L = { ...DEFAULT_LIMITS, ...o.limits };
  const results: ProfileResult[] = [];
  const report: Record<string, unknown> = { ...o.meta, startedAt: new Date().toISOString(), profiles: [] };
  const cleanups: (() => Promise<void> | void)[] = [];
  const streams = new Set<SseStream>();
  const stop = new AbortController();
  const deadline = setTimeout(
    () => stop.abort(new Error(`run deadline of ${L.runDeadlineMs} ms passed`)),
    L.runDeadlineMs,
  );
  const outside = () => stop.abort(o.signal?.reason ?? new Error("run stopped from outside"));
  o.signal?.addEventListener("abort", outside, { once: true });
  let error: string | undefined;
  const teardown: string[] = [];
  try {
    await untilAborted(
      (async () => {
        const specs = await o.setup({ onCleanup: (fn) => cleanups.push(fn), report, signal: stop.signal });
        for (const spec of specs) {
          if (stop.signal.aborted) break;
          const r = newResult(spec);
          results.push(r);
          await runProfile(spec, L, r, stop.signal, (s) => streams.add(s));
        }
      })(),
      stop.signal,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(deadline);
    o.signal?.removeEventListener("abort", outside);
    // Stop the work that may still wait in the background, then tear down; no step of teardown may hang.
    if (!stop.signal.aborted) stop.abort(new Error("run finished"));
    for (const s of streams) s.close();
    // Each step is bounded; one that fails or does not finish is recorded, and the run cannot pass (QA 6.1b P3).
    for (let n = cleanups.length - 1; n >= 0; n--) {
      let t: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        Promise.resolve()
          .then(cleanups[n])
          .then(
            () => "done" as const,
            (e: unknown) => `teardown step ${n + 1} failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        new Promise<string>((d) => {
          t = setTimeout(() => d(`teardown step ${n + 1} did not finish within ${L.cleanupTimeoutMs} ms`), L.cleanupTimeoutMs);
        }),
      ]);
      clearTimeout(t);
      if (outcome !== "done") teardown.push(outcome);
    }
  }
  const counts = { warmup: L.warmup, measured: L.measured };
  report.profiles = results.map((r) => ({
    ...r,
    stats: summarize(r.samples),
    warmupStats: summarize(r.warmup),
    problems: problems(r, counts),
  }));
  report.finishedAt = new Date().toISOString();
  const base = verdict(results, error, counts);
  // A run passes only when its teardown finished: nothing it started may still be running.
  const v: Verdict = teardown.length
    ? { result: "not valid", reasons: [...base.reasons, ...teardown.map((x) => `${x}${INVALID}`)] }
    : base;
  report.teardown = teardown;
  report.verdict = v;
  writeFileSync(o.out, `${JSON.stringify(report, null, 2)}\n`);
  return { verdict: v, report };
}
