import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

const medium = join(FIXTURES, "medium");
const tiny = join(FIXTURES, "tiny");

describe("aimem context", () => {
  it("prints the markdown briefing (golden)", async () => {
    const r = await cli([
      "context",
      "--task",
      "zod json schema export",
      "--paths",
      "packages/schema/src/record.ts",
      "--dir",
      medium,
    ]);
    expect(r.code).toBe(0);
    await expect(r.stdout).toMatchFileSnapshot("__snapshots__/briefing-medium-zod.md");
  });

  it("--json envelope carries the structured briefing (contract)", async () => {
    const r = await cli(["context", "--ref", "tsk-3c4d5e6f", "--json", "--dir", tiny]);
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/context.json",
    );
    expect(r.json.data.header.used).toBeLessThanOrEqual(r.json.data.header.budget);
  });

  it("--format json prints the briefing object without the envelope", async () => {
    const r = await cli(["context", "--task", "money", "--format", "json", "--dir", tiny]);
    expect(r.json.ok).toBeUndefined();
    expect(r.json.header.project).toBe("acme-ledger");
  });

  it("--explain adds the score table after the briefing", async () => {
    const r = await cli(["context", "--task", "money", "--explain", "--dir", tiny]);
    const [briefing, explain] = r.stdout.split("--- explain (not part of the briefing) ---");
    expect(briefing).toContain("# aimem briefing");
    expect(explain).toMatch(/REF\s+SECTION\s+PIN\s+TOTAL/);
    expect(explain).toContain("dec-1a2b3c4d");
  });

  it("with no arguments infers paths from git changes and words from the branch", async () => {
    const git = {
      calls: [] as string[][],
      run: async (args: string[], cwd: string) => {
        if (args[0] === "diff")
          return { code: 0, stdout: "src/ledger/rounding.ts\n.aimem/INDEX.md\n", stderr: "" };
        if (args[0] === "status") return { code: 0, stdout: "?? src/webhooks/handler.ts\n", stderr: "" };
        if (args[0] === "rev-parse" && args.includes("--abbrev-ref"))
          return { code: 0, stdout: "feat/fee-splits\n", stderr: "" };
        return fakeGit().run(args, cwd);
      },
    };
    const r = await cli(["context", "--json", "--dir", tiny], { git });
    expect(r.json.data.inferred).toEqual({
      paths: ["src/ledger/rounding.ts", "src/webhooks/handler.ts"],
      branch: "feat/fee-splits",
    });
    const refs = [...r.json.data.decisions, ...r.json.data.memories, ...r.json.data.other].map(
      (x: { ref: string }) => x.ref,
    );
    expect(refs).toContain("tsk-4d5e6f7g"); // paths src/ledger/rounding.ts + "fee splits"
    expect(refs).toContain("mem-5e6f7g8h"); // src/webhooks/**
  });

  it("warns for --mode hybrid and --deep, accepts --no-live", async () => {
    const r = await cli([
      "context",
      "--task",
      "money",
      "--mode",
      "hybrid",
      "--deep",
      "--no-live",
      "--json",
      "--dir",
      tiny,
    ]);
    expect(r.code).toBe(0);
    expect(r.json.warnings.join(" ")).toMatch(/hybrid/);
    expect(r.json.warnings.join(" ")).toMatch(/--deep/);
  });

  it.each([
    [["--budget", "100"], "USAGE"],
    [["--budget", "lots"], "USAGE"],
    [["--format", "xml"], "USAGE"],
    [["--ref", "tsk-zzzzzzzz"], "NOT_FOUND"],
  ])("%j → %s", async (args, code) => {
    const r = await cli(["context", ...args, "--json", "--dir", tiny]);
    expect(r.json.error.code).toBe(code);
  });
});
