---
aimem: 1
id: hnd-1bm1mbkn
type: handoff
title: "Handoff 2026-11-15: T4 aimem ask: core/ask askQuestion (hybrid retrieval, role lens, no-embed and secret exclusion, fra…"
summary: "Done: T4 aimem ask: core/ask askQuestion (hybrid retrieval, role lens, no-embed and secret exclusion, framed records, ASK_RULES, citation parsing and checking, confidence note, zero matches skip the…"
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-11-15T18:05:01Z
updated: 2026-11-15T18:05:01Z
task: tsk-pvrwny71
branch: feat/t4-ask-with-citations
---

## Done
T4 aimem ask: core/ask askQuestion (hybrid retrieval, role lens, no-embed and secret exclusion, framed records, ASK_RULES, citation parsing and checking, confidence note, zero matches skip the LLM); framing moved to core/render/frame; CLI ask command with LLM_FAILED when no LLM is usable; --json contract in docs/04; 15 §10 note. 741 tests pass. Merged PRs 27 (T1) and 28 (T2) first.

## Not done
No real-model run of ask (fake LLM only). No MCP aimem_ask tool (not in 05). PR 27 merged before its final CI run finished (repo disallows auto-merge); the same tree passed 723 tests locally.

## Next
T5 generation evals for ask (cases first: unanswerable, trap, citation precision, injection). Optionally try aimem ask on this repo with claude-cli and model sonnet.

## Blocked
none

## Notes for next agent
none
