---
aimem: 1
id: hnd-j2cghd9t
type: handoff
title: "Handoff 2026-11-15: T2 claude-cli LLM provider: core/process ProcessRunner (execa, empty temp cwd, stdin, timeout), cor…"
summary: "Done: T2 claude-cli LLM provider: core/process ProcessRunner (execa, empty temp cwd, stdin, timeout), core/llm LlmProvider + createClaudeCliProvider + loadLlmProvider; schema retrieval.llm.provider c…"
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-11-15T17:54:51Z
updated: 2026-11-15T17:54:51Z
task: tsk-4gt7sd44
branch: feat/t2-cli-llm-provider
---

## Done
T2 claude-cli LLM provider: core/process ProcessRunner (execa, empty temp cwd, stdin, timeout), core/llm LlmProvider + createClaudeCliProvider + loadLlmProvider; schema retrieval.llm.provider claude-cli + allow_remote + timeout_seconds; LLM_FAILED error (exit 4); doctor outbound-data line; ADR-017 and docs 03/04/11/15. Real claude -p calls verified tools off, no hooks, no session saved, login auth, Windows .cmd shim works. 711 tests pass.

## Not done
No CLI command uses the provider yet (aimem ask is T4). openai-compatible LLM provider still unimplemented. core/git does not map the Windows 'not recognized' message to 127.

## Next
T4 aimem ask with citations, built on loadLlmProvider. Merge order: T1 PR #27 and this PR are independent (both from main).

## Blocked
none

## Notes for next agent
none
