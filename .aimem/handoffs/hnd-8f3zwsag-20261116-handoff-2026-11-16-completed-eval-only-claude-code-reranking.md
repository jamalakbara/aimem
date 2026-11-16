---
aimem: 1
id: hnd-8f3zwsag
type: handoff
title: "Handoff 2026-11-16: Completed eval-only Claude Code reranking experiment. Eight held-out questions committed before run…"
summary: "Done: Completed eval-only Claude Code reranking experiment. Eight held-out questions committed before runs. 42 calls: medium and held-out recall at 10 both 1.0; paraphrase gain +0.2273 over lexical;…"
status: final
trust: agent
roles: [all]
author: agent:codex
created: 2026-11-16T22:01:58Z
updated: 2026-11-16T22:01:58Z
task: tsk-89xndc10
branch: codex/t8-rerank-experiment
---

## Done
Completed eval-only Claude Code reranking experiment. Eight held-out questions committed before runs. 42 calls: medium and held-out recall at 10 both 1.0; paraphrase gain +0.2273 over lexical; no keyword regression, fallbacks or forbidden-ref violations. Mean added latency 3.467s, p95 4.004s. Results and limits in docs/15 section 9.1. 761 tests passed, one skipped; lint/typecheck pass.

## Not done
Production reranking, query rewrite, adversarial injection checks, bounded prompt budget and trust/freshness policy. T7 default-path target remains open; experimental success is not a shipped fix.

## Next
Review experiment PR, then plan opt-in LLM reranking with candidate depth 50, strict validation/fallback, privacy and token budgets. Keep default none and offline path.

## Blocked
none

## Notes for next agent
Uses Claude Code login, no Anthropic API key. Top-20 candidate pool cannot recover all expected refs; top-50 contains them. Single-run results on one corpus; do not claim broad generalization.
