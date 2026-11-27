/**
 * Numbers and validity rules of the claim-visibility measurement (plan 6.1 §8, QA W11). Pure functions, so they
 * are checked locally without a database; the measurement itself runs only in the CI job `p95`.
 */

export const WARMUP = 20;
export const MEASURED = 300;
export const LIMIT_MS = 1_000;
export const SAMPLE_TIMEOUT_MS = 5_000;
/** Profile 3: the proxy delays each chunk this long, per direction. */
export const PROXY_DELAY_MS = 50;
/** Profile 3: the measured round trip through the proxy, and every sample, must be at least this. */
export const MIN_RTT_MS = 100;

/** Marks a reason that makes the run not valid (as opposed to a valid run that failed). */
export const INVALID = " (run not valid)";

export type ProfileName = "same-instance" | "two-instances" | "two-instances-proxied";
export const PROFILES: readonly ProfileName[] = ["same-instance", "two-instances", "two-instances-proxied"];

export type FailureKind = "timeout" | "missing" | "duplicate" | "status" | "instance" | "error";
export interface Failure {
  kind: FailureKind;
  sample: number;
  detail: string;
}

export interface ProfileResult {
  name: ProfileName;
  /** Instances that answered A's POST and B's stream, from the `Aimem-Instance` header. */
  instances: { a: string[]; b: string };
  /** Expected instance names: the same for profile 1, different for 2 and 3. */
  expected: { a: string; b: string };
  warmup: number[];
  samples: number[];
  failures: Failure[];
  /** Profile 3 only: round trips through the proxy before the samples. */
  rttMs?: number[];
}

export interface Stats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentile: the value at rank ⌈p/100 · n⌉ of the ascending list (p95 of 300 = the 285th). */
export function nearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("no values");
  if (!(p > 0 && p <= 100)) throw new Error("p must be in (0, 100]");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1] as number;
}

export function summarize(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? Number.NaN,
    p50: sorted.length ? nearestRank(sorted, 50) : Number.NaN,
    p95: sorted.length ? nearestRank(sorted, 95) : Number.NaN,
    p99: sorted.length ? nearestRank(sorted, 99) : Number.NaN,
    max: sorted.at(-1) ?? Number.NaN,
  };
}

/**
 * Why a profile does not count, empty when it does. Nothing is discarded or retried: any failure, a wrong sample
 * count, a wrong instance, or (profile 3) a round trip or sample under 100 ms makes the run invalid or failed.
 */
export interface Counts {
  warmup: number;
  measured: number;
}
const COUNTS: Counts = { warmup: WARMUP, measured: MEASURED };

export function problems(r: ProfileResult, counts: Counts = COUNTS): string[] {
  const out: string[] = [];
  // Samples missing because of failures make a failed run; missing without a failure, a run that is not valid.
  const mark = r.failures.length ? "" : INVALID;
  if (r.warmup.length !== counts.warmup)
    out.push(`${r.name}: ${r.warmup.length} warm-up samples, expected ${counts.warmup}${mark}`);
  if (r.samples.length !== counts.measured)
    out.push(`${r.name}: ${r.samples.length} samples, expected ${counts.measured}${mark}`);
  for (const f of r.failures) out.push(`${r.name}: sample ${f.sample} ${f.kind}: ${f.detail}`);
  // One limit per sample, from sending the POST to receiving the event (QA 6.1b P2): a longer one fails the run.
  const over = [...r.warmup, ...r.samples].filter((x) => x > SAMPLE_TIMEOUT_MS);
  if (over.length) out.push(`${r.name}: ${over.length} samples over ${SAMPLE_TIMEOUT_MS} ms`);
  const wrongA = r.instances.a.filter((x) => x !== r.expected.a);
  if (wrongA.length) out.push(`${r.name}: ${wrongA.length} POSTs answered by another instance than ${r.expected.a}${INVALID}`);
  if (r.instances.b !== r.expected.b) out.push(`${r.name}: stream on ${r.instances.b || "no instance"}, expected ${r.expected.b}${INVALID}`);
  const twoInstances = r.name !== "same-instance";
  if (twoInstances && r.expected.a === r.expected.b) out.push(`${r.name}: A and B must use different instances${INVALID}`);
  if (!twoInstances && r.expected.a !== r.expected.b) out.push(`${r.name}: A and B must use the same instance${INVALID}`);
  if (r.name === "two-instances-proxied") {
    const rtt = r.rttMs ?? [];
    if (rtt.length === 0) out.push(`${r.name}: round trip through the proxy was not measured${INVALID}`);
    else if (Math.min(...rtt) < MIN_RTT_MS)
      out.push(`${r.name}: round trip ${Math.min(...rtt).toFixed(1)} ms < ${MIN_RTT_MS} ms${INVALID}`);
    const short = r.samples.filter((x) => x < MIN_RTT_MS);
    if (short.length) out.push(`${r.name}: ${short.length} samples < ${MIN_RTT_MS} ms${INVALID}`);
  }
  if (out.length === 0 && summarize(r.samples).p95 >= LIMIT_MS)
    out.push(`${r.name}: p95 ${summarize(r.samples).p95.toFixed(1)} ms ≥ ${LIMIT_MS} ms`);
  return out;
}

export interface Verdict {
  /** "passed in simulation" only; never a claim about a LAN or the internet (plan §8). */
  result: "passed in simulation" | "failed" | "not valid";
  reasons: string[];
}

/** All three profiles must be there and clean; a validity problem wins over a slow p95. */
export function verdict(results: readonly ProfileResult[], error?: string, counts: Counts = COUNTS): Verdict {
  const reasons: string[] = [];
  if (error) reasons.push(`run stopped: ${error}${INVALID}`);
  for (const name of PROFILES)
    if (!results.some((r) => r.name === name)) reasons.push(`${name}: profile did not run${INVALID}`);
  for (const r of results) reasons.push(...problems(r, counts));
  if (reasons.length === 0) return { result: "passed in simulation", reasons };
  const invalid = reasons.some((x) => x.endsWith(INVALID));
  return { result: invalid ? "not valid" : "failed", reasons };
}
