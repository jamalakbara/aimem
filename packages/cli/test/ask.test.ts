import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AimemError,
  type LlmProvider,
  type LlmStatus,
  loadLlmProvider,
  type ProcessRunner,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-ask-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const llm = (text: string): LlmProvider => ({ id: "fake:model", generate: async () => ({ text }) });
const available = (provider: LlmProvider) => (): LlmStatus => ({ available: true, provider });
/** The real loader with a runner that must never run. */
const realLoader = (config: Parameters<typeof loadLlmProvider>[0]) => {
  const runner: ProcessRunner = {
    run: async () => {
      throw new Error("no process may run in tests");
    },
  };
  return loadLlmProvider(config, { runner, env: {} });
};

describe("aimem ask (04 §2, 15 §10)", () => {
  it("answers with sources and a confidence note (contract)", async () => {
    const r = await cli(["ask", "how do we store money amounts?", "--json", "--dir", dir], {
      loadLlm: available(llm("Amounts are integer minor units [dec-1a2b3c4d].")),
    });
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/ask.json",
    );
  });

  it("prints the answer, Sources and the confidence note", async () => {
    const r = await cli(["ask", "how do we store money amounts?", "--dir", dir], {
      loadLlm: available(llm("Amounts are integer minor units [dec-1a2b3c4d].")),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Amounts are integer minor units [dec-1a2b3c4d].");
    expect(r.stdout).toContain("Sources:");
    expect(r.stdout).toContain("- [dec-1a2b3c4d] Store money as integer minor units (decision, verified");
    expect(r.stdout).toContain("Confidence: based on 1 verified record");
  });

  it("not found exits 0 with found: false", async () => {
    const r = await cli(["ask", "kubernetes helm autoscaling", "--json", "--dir", dir], {
      loadLlm: available(llm("unused")),
    });
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ found: false, sources: [], answer: "Not found in the notebook." });
  });

  it("without an LLM: LLM_FAILED (exit 4) that says how to enable one", async () => {
    const r = await cli(["ask", "money?", "--json", "--dir", dir], { loadLlm: realLoader });
    expect(r.code).toBe(4);
    expect(r.json.error.code).toBe("LLM_FAILED");
    expect(r.json.error.message).toMatch(/retrieval\.llm\.provider: claude-cli/);
    expect(r.json.error.message).toMatch(/allow_remote: true/);
  });

  it("respects the allow_remote gate", async () => {
    appendFileSync(join(dir, ".aimem", "project.yaml"), "\nretrieval:\n  llm:\n    provider: claude-cli\n");
    const r = await cli(["ask", "money?", "--json", "--dir", dir], { loadLlm: realLoader });
    expect(r.code).toBe(4);
    expect(r.json.error.message).toMatch(/allow_remote: true/);
  });

  it("an LLM failure surfaces as LLM_FAILED", async () => {
    const failing: LlmProvider = {
      id: "fake",
      generate: async () => {
        throw new AimemError("LLM_FAILED", "claude -p timed out after 120 s", { provider: "claude-cli" });
      },
    };
    const r = await cli(["ask", "money amounts?", "--json", "--dir", dir], { loadLlm: available(failing) });
    expect(r.code).toBe(4);
    expect(r.json.error).toMatchObject({ code: "LLM_FAILED", message: "claude -p timed out after 120 s" });
  });

  it("rejects an empty question", async () => {
    const r = await cli(["ask", "  ", "--json", "--dir", dir], { loadLlm: available(llm("x")) });
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("USAGE");
  });
});
