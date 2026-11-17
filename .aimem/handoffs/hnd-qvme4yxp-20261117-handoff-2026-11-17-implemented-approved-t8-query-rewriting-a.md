---
aimem: 1
id: hnd-qvme4yxp
type: handoff
title: "Handoff 2026-11-17: Implemented approved T8 query rewriting and local cross-encoder ranking across core, CLI and MCP; e…"
summary: "Done: Implemented approved T8 query rewriting and local cross-encoder ranking across core, CLI and MCP; explicit ranker setup/doctor and metadata diagnostics. Implemented T9 explicit per-session usag…"
status: final
trust: agent
roles: [all]
author: agent:codex
created: 2026-11-17T17:26:00Z
updated: 2026-11-17T17:26:00Z
---

## Done
Implemented approved T8 query rewriting and local cross-encoder ranking across core, CLI and MCP; explicit ranker setup/doctor and metadata diagnostics. Implemented T9 explicit per-session usage capture with validated local JSONL appends. Added T7 held-out cases and measured centering/E5-base without changing defaults. Published stacked draft PRs #38-#48. Lint/typecheck/build and 825 tests pass (one skipped); default briefing and fake-answer eval baselines unchanged. Real 22-case comparisons completed after Claude Code login with zero provider errors.

## Not done
T7 remains open: default paraphrase gain is +0.0909, below +0.15. T8/T9 are review-ready, not merged. Neither optional T8 mode improved citation precision in the real run; both remain off by default. context --deep remains reserved.

## Next
Review the stacked draft PRs in order. Retain the measured T8 caveats in docs/19; revisit T7 with a new retrieval approach without weakening trust/freshness or changing expected answers. Finish pending CI checks before merge.

## Blocked
No coding blocker. Some hosted CI jobs are queued. T7 numerical acceptance is unmet.

## Notes for next agent
Real answer citation precision baseline 0.6250, rewrite 0.5952, local ranker 0.5435; refusal 1.0, trap wins 0. Baseline marker-based injection metric 0.5 reflects quoting a rejected marker; optional modes 1.0. Windows CI fixture-hook timeout was corrected by bounding Vitest workers to four and propagated through stack; Windows checks refreshed successfully on PR40. Existing uncommitted notebook notes were preserved; handoff auto-commit disabled for this process.
