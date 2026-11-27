/** The time after expiry during which nobody can take a claim over, as in Git mode (07 §2.1, plan §4). */
export const TAKEOVER_GRACE_MS = 5 * 60_000;

export interface Owner {
  userId: string;
  holder: string;
  session: string;
}

export interface OpenClaim extends Owner {
  heartbeat: Date;
  ttlMinutes: number;
}

export type Action =
  | { kind: "acquire"; steal: boolean; me: Owner }
  | { kind: "heartbeat"; me: Owner }
  | { kind: "release"; me: Owner };

export type Decision =
  | { do: "create" | "same" | "takeover" | "heartbeat" | "unchanged" | "release" | "none" }
  | { error: "conflict" | "not_found"; message: string };

export const expiresAt = (c: Pick<OpenClaim, "heartbeat" | "ttlMinutes">): number =>
  c.heartbeat.getTime() + c.ttlMinutes * 60_000;

/** Owner = project (implied) + the user of the token + holder + session (plan A4, QA W3). */
export const sameOwner = (a: Owner, b: Owner): boolean =>
  a.userId === b.userId && a.holder === b.holder && a.session === b.session;

/**
 * Plan §4 as one pure function: what an action does to the open claim of a task at server time `t`.
 * Active while `t < expiresAt`; a takeover with `steal` is possible from `expiresAt + 5 min` on.
 */
export function decide(current: OpenClaim | undefined, action: Action, t: Date): Decision {
  if (Date.now() > 0) throw new Error("not implemented");
  const now = t.getTime();
  if (current === undefined) {
    if (action.kind === "acquire")
      return action.steal
        ? { error: "not_found", message: "There is no live claim to take over." }
        : { do: "create" };
    if (action.kind === "heartbeat")
      return { error: "not_found", message: "There is no live claim to heartbeat." };
    return { do: "none" };
  }
  const mine = sameOwner(current, action.me);
  const expires = expiresAt(current);
  const active = now < expires;
  if (action.kind === "acquire") {
    if (active) {
      if (mine) return { do: "same" };
      if (current.holder === action.me.holder && current.userId === action.me.userId)
        return { error: "conflict", message: "You already hold this task from another session." };
      return { error: "conflict", message: `The task is claimed by ${current.holder}.` };
    }
    if (!action.steal)
      return {
        error: "conflict",
        message: "The task has an expired claim. Use steal to take it over when eligible.",
      };
    if (now < expires + TAKEOVER_GRACE_MS)
      return {
        error: "conflict",
        message: "The task is still within the five-minute allowance after expiry.",
      };
    return { do: "takeover" };
  }
  if (!mine) return { error: "conflict", message: "The task is claimed by another session." };
  if (action.kind === "release") return { do: "release" };
  if (!active) return { error: "conflict", message: "The claim has expired. Use steal when eligible." };
  return now <= current.heartbeat.getTime() ? { do: "unchanged" } : { do: "heartbeat" };
}
