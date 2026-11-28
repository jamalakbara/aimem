/**
 * Stop signals of the claim-visibility harness (plan 6.1 §8): SIGTERM or SIGINT (a cancelled CI job) stop the run
 * like its deadline, so teardown runs and the report is written.
 */
export interface StopSignals {
  signal: AbortSignal;
  /** Removes the handlers once teardown and the report are done. */
  dispose(): void;
}

export function stopOnSignals(names: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"]): StopSignals {
  const outside = new AbortController();
  for (const sig of names) process.once(sig, () => outside.abort(new Error(`stopped by ${sig}`)));
  return { signal: outside.signal, dispose: () => undefined };
}
