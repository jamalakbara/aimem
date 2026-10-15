import { join } from "node:path";
import { ERROR_CODES } from "@aimem/schema";
import { EXIT_CODES } from "aimem";
import { describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

const medium = join(FIXTURES, "medium");

describe("--json envelope (04 §7)", () => {
  it.each([
    ["show", ["show", "dec-mtbcq7yr"]],
    ["show-links", ["show", "dec-mtbcq7yr", "--links"]],
    ["list-memory-stale", ["list", "memory", "--stale"]],
    ["list-trust", ["list", "--trust", "inferred"]],
    ["search", ["search", "zod json schema", "--limit", "3"]],
    ["validate-medium", ["validate"]],
  ])("%s matches the saved contract", async (name, args) => {
    const r = await cli([...args, "--json", "--dir", medium]);
    expect(r.stderr).toBe("");
    expect(r.json.ok).toBe(true);
    expect(r.json.command).toBe(args[0]);
    expect(Array.isArray(r.json.warnings)).toBe(true);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      `__snapshots__/contracts/${name}.json`,
    );
  });

  it("failures carry ok:false and a stable code, and nothing else on stdout", async () => {
    const r = await cli(["show", "mem-zzzzzzzz", "--json", "--dir", medium]);
    expect(r.code).toBe(1);
    expect(r.json).toEqual({ ok: false, error: { code: "NOT_FOUND", message: expect.any(String) } });
  });

  it.each([[["lst"]], [["show"]], [["search", "x", "--limit", "many"]], [["list", "--bogus"]]])(
    "usage mistakes %j → USAGE, exit 2",
    async (args) => {
      const r = await cli([...args, "--json", "--dir", medium]);
      expect(r.code).toBe(2);
      expect(r.json.ok).toBe(false);
      expect(r.json.error.code).toBe("USAGE");
    },
  );

  it("human mode prints a usage error once; no command prints help", async () => {
    const typo = await cli(["lst", "--dir", medium]);
    expect(typo.code).toBe(2);
    expect(typo.stderr.match(/unknown command 'lst'/g)).toHaveLength(1);
    expect(typo.stderr).toContain("Did you mean list?");
    const none = await cli([]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("Usage: aimem");
  });

  it("outside a notebook → NOT_INITIALIZED, exit 2", async () => {
    const r = await cli(["list", "--json", "--dir", "/"]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("NOT_INITIALIZED");
  });
});

describe("exit codes (04 §1)", () => {
  it("every error code has a documented exit code", () => {
    expect(Object.keys(EXIT_CODES).sort()).toEqual([...ERROR_CODES].sort());
    expect(EXIT_CODES).toMatchObject({
      NOT_FOUND: 1,
      USAGE: 2,
      INVALID_RECORD: 2,
      NOT_INITIALIZED: 2,
      SECRET_DETECTED: 2,
      DUPLICATE_LIKELY: 3,
      CLAIM_CONFLICT: 3,
      SYNC_FAILED: 4,
      SOURCE_UNREACHABLE: 4,
    });
  });

  it("--version prints the version and exits 0", async () => {
    const r = await cli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
