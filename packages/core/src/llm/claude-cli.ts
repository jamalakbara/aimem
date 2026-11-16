import { AimemError } from "../errors.js";
import { tokenUsage } from "../log/calls.js";
import type { ProcessRunner } from "../process/run.js";
import type { LlmProvider } from "./provider.js";

/**
 * `claude -p` flags (T2, ADR-017). Not `--bare`: bare mode reads only ANTHROPIC_API_KEY or an
 * apiKeyHelper, never the Claude Code login, so it would defeat reusing that login. The extras
 * bare mode would skip are switched off one by one instead:
 * - `--tools ""`: no tools at all (09 §3: no tool use in ask)
 * - `--no-session-persistence`: nothing saved under ~/.claude/projects
 * - `--strict-mcp-config` (with no --mcp-config): no MCP servers
 * - `--disable-slash-commands`: no skills or commands
 * - `--setting-sources ""`: no user/project/local settings, so no hooks or plugins add text
 * The runner also uses an empty temp working directory, so no project CLAUDE.md is discovered.
 */
export const CLAUDE_CLI_ARGS = [
  "-p",
  "--output-format",
  "json",
  "--tools",
  "",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--setting-sources",
  "",
] as const;

/** Passed as a file: multi-line arguments do not survive Windows `.cmd` shims. */
const SYSTEM_FILE = "system-prompt.md";

export interface ClaudeCliOptions {
  runner: ProcessRunner;
  /** `claude`, or the AIMEM_CLAUDE_BIN override. */
  command: string;
  model?: string;
  timeoutMs: number;
}

const firstLine = (s: string) => s.trim().split("\n")[0]?.trim() ?? "";

/** Generation through the user's Claude Code login (`claude -p`); no API key in aimem. */
export function createClaudeCliProvider(opts: ClaudeCliOptions): LlmProvider {
  const id = opts.model ? `claude-cli:${opts.model}` : "claude-cli";
  const fail = (message: string, details: Record<string, unknown> = {}) =>
    new AimemError("LLM_FAILED", message, { provider: "claude-cli", ...details });
  return {
    id,
    async generate(req) {
      const args = [...CLAUDE_CLI_ARGS, "--system-prompt-file", SYSTEM_FILE];
      if (opts.model) args.push("--model", opts.model);
      const r = await opts.runner.run(opts.command, args, {
        input: req.prompt,
        files: { [SYSTEM_FILE]: req.system },
        timeoutMs: opts.timeoutMs,
      });
      if (r.timedOut) throw fail(`claude -p timed out after ${Math.round(opts.timeoutMs / 1000)} s`);
      if (r.code === 127)
        throw fail(
          `claude CLI not found (${opts.command}); install Claude Code or set AIMEM_CLAUDE_BIN to its path`,
        );
      if (r.code !== 0) {
        const err = `${r.stderr}\n${r.stdout}`;
        if (/\/login|not logged in|invalid api key|authenticat/i.test(err))
          throw fail("claude CLI is not logged in; run claude and use /login, then try again", {
            exitCode: r.code,
          });
        throw fail(`claude -p exited with code ${r.code}: ${firstLine(r.stderr || r.stdout)}`, {
          exitCode: r.code,
        });
      }
      let out: { is_error?: unknown; result?: unknown; subtype?: unknown; usage?: Record<string, unknown> };
      try {
        out = JSON.parse(r.stdout);
      } catch {
        throw fail("claude -p returned unexpected output (expected --output-format json)");
      }
      if (out.is_error === true)
        throw fail(
          `claude -p failed: ${String(out.subtype ?? "error")}${out.result ? ` — ${firstLine(String(out.result))}` : ""}`,
        );
      if (typeof out.result !== "string") throw fail("claude -p returned unexpected output (no result text)");
      const usage = tokenUsage({
        inputTokens: out.usage?.input_tokens,
        outputTokens: out.usage?.output_tokens,
        cacheReadTokens: out.usage?.cache_read_input_tokens,
        cacheCreationTokens: out.usage?.cache_creation_input_tokens,
      });
      return { text: out.result, ...(usage ? { usage } : {}) };
    },
  };
}
