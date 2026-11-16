import { existsSync } from "node:fs";
import {
  AimemError,
  CLAUDE_CLI_ARGS,
  createClaudeCliProvider,
  execaRunner,
  loadLlmProvider,
  type ProcessResult,
  type ProcessRunner,
  type RunOptions,
} from "@aimem/core";
import { describe, expect, it } from "vitest";

/** Fake runner: records each call and answers with a canned result (no real process). */
function fakeRunner(result: Partial<ProcessResult> = {}) {
  const calls: { command: string; args: string[]; opts: RunOptions }[] = [];
  const runner: ProcessRunner = {
    async run(command, args, opts) {
      calls.push({ command, args, opts });
      return { code: 0, stdout: "", stderr: "", timedOut: false, ...result };
    },
  };
  return { runner, calls };
}
const ok = (text: string) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "x" });

async function failure(p: Promise<unknown>): Promise<AimemError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AimemError) return e;
    throw e;
  }
  throw new Error("expected a failure");
}

const provider = (runner: ProcessRunner, extra: { model?: string; timeoutMs?: number } = {}) =>
  createClaudeCliProvider({ runner, command: "claude", timeoutMs: extra.timeoutMs ?? 120_000, ...extra });

describe("claude-cli LLM provider (T2, 15 §11)", () => {
  it("retains numeric token usage returned by Claude", async () => {
    const f = fakeRunner({
      stdout: JSON.stringify({
        result: "ok",
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 8,
        },
      }),
    });
    expect((await provider(f.runner).generate({ system: "s", prompt: "p" })).usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 5,
      cacheCreationTokens: 8,
    });
  });
  it("runs claude -p with tools, sessions, MCP, slash commands and settings off", async () => {
    const f = fakeRunner({ stdout: ok("Answer [dec-1]") });
    const r = await provider(f.runner).generate({ system: "Rules\nline 2", prompt: "Question?" });
    expect(r.text).toBe("Answer [dec-1]");
    const call = f.calls[0];
    expect(call?.command).toBe("claude");
    expect(call?.args).toEqual([...CLAUDE_CLI_ARGS, "--system-prompt-file", "system-prompt.md"]);
    expect(call?.args).toContain("--tools");
    expect(call?.args[call.args.indexOf("--tools") + 1]).toBe("");
    expect(call?.args).toContain("--no-session-persistence");
    expect(call?.args).not.toContain("--bare"); // --bare ignores the Claude Code login (OAuth)
    expect(call?.opts.input).toBe("Question?");
    expect(call?.opts.files).toEqual({ "system-prompt.md": "Rules\nline 2" });
    expect(call?.opts.timeoutMs).toBe(120_000);
  });

  it("passes --model only when configured", async () => {
    const f = fakeRunner({ stdout: ok("x") });
    await provider(f.runner, { model: "sonnet" }).generate({ system: "s", prompt: "p" });
    expect(f.calls[0]?.args.slice(-2)).toEqual(["--model", "sonnet"]);
    expect(provider(f.runner, { model: "sonnet" }).id).toBe("claude-cli:sonnet");
    expect(provider(f.runner).id).toBe("claude-cli");
  });

  it.each([
    [{ code: 127, stderr: "spawn claude ENOENT" }, /claude CLI not found.*AIMEM_CLAUDE_BIN/],
    [{ timedOut: true, code: 1 }, /timed out after 120 s/],
    [{ code: 1, stderr: "Invalid API key · Please run /login" }, /not logged in.*claude.*\/login/],
    [{ code: 2, stderr: "boom\nmore" }, /claude -p exited with code 2: boom/],
    [{ stdout: "not json" }, /unexpected output/],
    [
      { stdout: JSON.stringify({ type: "result", is_error: true, subtype: "error_max_turns", result: "" }) },
      /claude -p failed: error_max_turns/,
    ],
  ])("maps failures to LLM_FAILED: %j", async (result, message) => {
    const e = await failure(
      provider(fakeRunner(result).runner).generate({ system: "s", prompt: "secret q" }),
    );
    expect(e.code).toBe("LLM_FAILED");
    expect(e.message).toMatch(message);
    expect(e.message).not.toContain("secret q");
    expect(e.details).toMatchObject({ provider: "claude-cli" });
  });
});

describe("loadLlmProvider (15 §11–§12)", () => {
  const runner = fakeRunner().runner;
  const load = (llm: Record<string, unknown> | undefined, env: Record<string, string> = {}) =>
    loadLlmProvider({ retrieval: llm ? { llm } : {} }, { runner, env });

  it("is off by default and for provider none", () => {
    expect(load(undefined)).toEqual({ available: false, reason: "retrieval.llm.provider is none" });
    expect(load({ provider: "none" })).toMatchObject({ available: false });
  });

  it("claude-cli needs allow_remote, because record text goes to Anthropic", () => {
    const off = load({ provider: "claude-cli" });
    expect(off).toMatchObject({ available: false });
    expect(off.available ? "" : off.reason).toMatch(/allow_remote: true/);
  });

  it("claude-cli with allow_remote uses AIMEM_CLAUDE_BIN, model and timeout", async () => {
    const f = fakeRunner({ stdout: ok("hi") });
    const s = loadLlmProvider(
      {
        retrieval: {
          llm: { provider: "claude-cli", allow_remote: true, model: "sonnet", timeout_seconds: 30 },
        },
      },
      { runner: f.runner, env: { AIMEM_CLAUDE_BIN: "/opt/claude" } },
    );
    if (!s.available) throw new Error(s.reason);
    await s.provider.generate({ system: "s", prompt: "p" });
    expect(f.calls[0]?.command).toBe("/opt/claude");
    expect(f.calls[0]?.opts.timeoutMs).toBe(30_000);
    expect(s.provider.id).toBe("claude-cli:sonnet");
  });

  it("openai-compatible LLM is not implemented yet", () => {
    expect(load({ provider: "openai-compatible", allow_remote: true })).toMatchObject({ available: false });
  });
});

describe("execaRunner", () => {
  it("writes files into a fresh temp cwd, feeds stdin, and removes the dir afterwards", async () => {
    const r = await execaRunner().run(
      process.execPath,
      [
        "-e",
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const fs=require('fs');console.log(JSON.stringify({cwd:process.cwd(),file:fs.readFileSync('a.txt','utf8'),stdin:s}))})",
      ],
      { input: "hello", files: { "a.txt": "line1\nline2" }, timeoutMs: 20_000 },
    );
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ file: "line1\nline2", stdin: "hello" });
    expect(existsSync(out.cwd)).toBe(false);
  });

  it("reports a missing binary as code 127 and a timeout as timedOut", async () => {
    expect((await execaRunner().run("aimem-no-such-binary-xyz", [], { timeoutMs: 5_000 })).code).toBe(127);
    const slow = await execaRunner().run(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
      timeoutMs: 200,
    });
    expect(slow.timedOut).toBe(true);
  });

  it("passes empty-string arguments through intact", async () => {
    const r = await execaRunner().run(
      process.execPath,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "", "x"],
      { timeoutMs: 20_000 },
    );
    expect(JSON.parse(r.stdout)).toEqual(["", "x"]);
  });
});
