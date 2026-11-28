/**
 * Stop signals of the claim-visibility harness (plan 6.1 §8): SIGTERM or SIGINT (a cancelled CI job) stop the run
 * like its deadline, so teardown runs and the report is written.
 *
 * The handlers stay until `dispose()`, which the harness calls only after teardown and the report are done. A
 * repeated signal is idempotent: it is noted and does nothing else, so it cannot cut teardown short (QA 6.1b R1).
 * Teardown is bounded on its own; SIGKILL still ends the harness at once.
 */
export interface StopSignals {
  signal: AbortSignal;
  /** Removes the handlers once teardown and the report are done. */
  dispose(): void;
}

export function stopOnSignals(
  names: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"],
  note: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): StopSignals {
  const outside = new AbortController();
  const handlers = names.map((sig) => {
    const handler = () => {
      if (outside.signal.aborted) {
        note(`${sig} received again; teardown is already running and continues`);
        return;
      }
      outside.abort(new Error(`stopped by ${sig}`));
    };
    process.on(sig, handler);
    return [sig, handler] as const;
  });
  return {
    signal: outside.signal,
    dispose: () => {
      for (const [sig, handler] of handlers) process.off(sig, handler);
    },
  };
}
