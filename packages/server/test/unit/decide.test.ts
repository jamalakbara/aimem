import { type Action, decide, type OpenClaim, type Owner, TAKEOVER_GRACE_MS } from "@aimem/server";
import { describe, expect, it } from "vitest";

const me: Owner = { userId: "1", holder: "agent:bot", session: "s1" };
const sameHolderOtherSession: Owner = { ...me, session: "s2" };
const otherUserSameName: Owner = { ...me, userId: "2" };
const other: Owner = { userId: "3", holder: "human:rina", session: "s1" };
const T0 = new Date("2026-11-27T10:00:00.000Z");
const claim: OpenClaim = { ...me, heartbeat: T0, ttlMinutes: 10 };
const expiry = T0.getTime() + 10 * 60_000;
const at = (ms: number) => new Date(ms);
const states = {
  active: at(expiry - 1),
  expiredAtBoundary: at(expiry),
  inGrace: at(expiry + TAKEOVER_GRACE_MS - 1),
  graceBoundary: at(expiry + TAKEOVER_GRACE_MS),
  later: at(expiry + TAKEOVER_GRACE_MS + 60_000),
};
const result = (d: ReturnType<typeof decide>) => ("error" in d ? d.error : d.do);

describe("decide: plan §4 (QA W1, A8)", () => {
  it("no claim", () => {
    expect(result(decide(undefined, { kind: "acquire", steal: false, me }, T0))).toBe("create");
    expect(result(decide(undefined, { kind: "acquire", steal: true, me }, T0))).toBe("not_found");
    expect(result(decide(undefined, { kind: "heartbeat", me }, T0))).toBe("not_found");
    expect(result(decide(undefined, { kind: "release", me }, T0))).toBe("none");
  });

  const table: [string, Action, Record<keyof typeof states, string>][] = [
    [
      "acquire, same owner",
      { kind: "acquire", steal: false, me },
      {
        active: "same",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
    [
      "acquire, same holder, other session",
      { kind: "acquire", steal: false, me: sameHolderOtherSession },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
    [
      "acquire, other owner",
      { kind: "acquire", steal: false, me: other },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
    [
      "steal, same owner (retry)",
      { kind: "acquire", steal: true, me },
      {
        active: "same",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "takeover",
        later: "takeover",
      },
    ],
    [
      "steal, other owner",
      { kind: "acquire", steal: true, me: other },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "takeover",
        later: "takeover",
      },
    ],
    [
      "steal, same agent name of another user",
      { kind: "acquire", steal: true, me: otherUserSameName },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "takeover",
        later: "takeover",
      },
    ],
    [
      "heartbeat, owner",
      { kind: "heartbeat", me },
      {
        active: "heartbeat",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
    [
      "heartbeat, other",
      { kind: "heartbeat", me: other },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
    [
      "heartbeat, same agent name of another user",
      { kind: "heartbeat", me: otherUserSameName },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
    [
      "release, owner",
      { kind: "release", me },
      {
        active: "release",
        expiredAtBoundary: "release",
        inGrace: "release",
        graceBoundary: "release",
        later: "release",
      },
    ],
    [
      "release, other",
      { kind: "release", me: other },
      {
        active: "conflict",
        expiredAtBoundary: "conflict",
        inGrace: "conflict",
        graceBoundary: "conflict",
        later: "conflict",
      },
    ],
  ];
  for (const [name, action, expected] of table)
    it(name, () => {
      for (const [state, t] of Object.entries(states))
        expect(result(decide(claim, action, t)), `${name} at ${state}`).toBe(
          expected[state as keyof typeof states],
        );
    });

  it("a heartbeat at or before the stored one changes nothing", () => {
    expect(result(decide(claim, { kind: "heartbeat", me }, T0))).toBe("unchanged");
    expect(result(decide(claim, { kind: "heartbeat", me }, at(T0.getTime() - 5)))).toBe("unchanged");
  });
});
