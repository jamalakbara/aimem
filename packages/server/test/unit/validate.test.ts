import type { IncomingMessage } from "node:http";
import { newToken } from "@aimem/server";
import { describe, expect, it } from "vitest";
import { readAcquire, readSession, readTaskId } from "../../src/validate.js";

const req = (...pairs: string[]) => ({ rawHeaders: pairs }) as unknown as IncomingMessage;
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return `${(e as { status?: number }).status} ${(e as { code?: string }).code}`;
  }
};
const body = (o: unknown) => JSON.stringify(o);
const T = "tsk-0a1b2c3d";

describe("request validation (plan §6, KT-2, BR-1)", () => {
  it("reads one session header with the core rule, never a token", () => {
    expect(readSession(req("Aimem-Session", "s-1"))).toBe("s-1");
    for (const h of [
      [],
      ["Aimem-Session", ""],
      ["Aimem-Session", "a b"],
      ["Aimem-Session", "-x"],
      ["Aimem-Session", "x".repeat(65)],
      ["Aimem-Session", "s1", "aimem-session", "s1"],
      ["Aimem-Session", "aimem_abc"],
      ["Aimem-Session", newToken()],
    ])
      expect(
        code(() => readSession(req(...h))),
        JSON.stringify(h),
      ).toBe("400 USAGE");
  });

  it("accepts the fields of the contract and fills the TTL", () => {
    expect(readAcquire(body({ task: T }), "alpha", "s1")).toEqual({
      task: `alpha:${T}`,
      ttlMinutes: 180,
      steal: false,
    });
    expect(
      readAcquire(
        body({
          task: `alpha:${T}`,
          paths: ["src/**"],
          note: "  hi\u0007there ",
          ttl_minutes: 1440,
          steal: true,
        }),
        "alpha",
        "s1",
      ),
    ).toEqual({ task: `alpha:${T}`, paths: ["src/**"], note: "hi there", ttlMinutes: 1440, steal: true });
  });

  it("refuses everything else with 400 and no detail about the value", () => {
    const bad: unknown[] = [
      null,
      [],
      "x",
      1,
      {},
      { task: T, holder: "human:boss" },
      { task: T, on_behalf_of: "human:x" },
      { task: T, started: "x" },
      { task: "dec-0a1b2c3d" },
      { task: "mem-0a1b2c3d" },
      { task: `beta:${T}` },
      { task: "tsk-0A1B2C3D" },
      { task: 5 },
      { task: T, paths: [] },
      { task: T, paths: "src" },
      { task: T, paths: [""] },
      { task: T, paths: Array(33).fill("a") },
      { task: T, paths: ["a".repeat(257)] },
      { task: T, paths: ["/etc"] },
      { task: T, paths: ["../x"] },
      { task: T, note: 5 },
      { task: T, note: "x".repeat(501) },
      { task: T, ttl_minutes: 0 },
      { task: T, ttl_minutes: -1 },
      { task: T, ttl_minutes: 1441 },
      { task: T, ttl_minutes: 1.5 },
      { task: T, ttl_minutes: "10" },
      { task: T, steal: "yes" },
    ];
    for (const b of bad)
      expect(
        code(() => readAcquire(body(b), "alpha", "s1")),
        JSON.stringify(b),
      ).toBe("400 USAGE");
    expect(code(() => readAcquire("{", "alpha", "s1"))).toBe("400 USAGE");
  });

  it("refuses a token or a key in any metadata that other readers see", () => {
    for (let i = 0; i < 50; i++) {
      const t = newToken();
      expect(code(() => readAcquire(body({ task: T, note: `see ${t}` }), "alpha", "s1"))).toBe(
        "400 SECRET_DETECTED",
      );
      expect(code(() => readAcquire(body({ task: T, paths: [`src/${t}`] }), "alpha", "s1"))).toBe(
        "400 SECRET_DETECTED",
      );
    }
  });

  it("reads a bare task ID from the address", () => {
    expect(readTaskId(T)).toBe(T);
    for (const raw of ["alpha:tsk-0a1b2c3d", "tsk-0a1b2c3", "dec-0a1b2c3d", "%E0%A4%A", "tsk-0a1b2c3d%00"])
      expect(
        code(() => readTaskId(raw)),
        raw,
      ).toBe("400 USAGE");
  });
});
