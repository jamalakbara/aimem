---
aimem: 1
id: tsk-ewvajxqv
type: task
title: Stop long handoffs outranking how-to notes in search
summary: "Dogfooding: questions like how to run tests return long handoff notes before the matching how-to memory."
status: done
trust: agent
roles: [dev]
tags: [search, dogfood]
paths: [packages/core/src/context/**, packages/core/src/search/**]
author: agent:claude-code
created: 2026-10-15T02:59:38Z
updated: 2026-11-17T22:11:37Z
priority: p2
---

## Goal
A direct how-to answer ranks above handoffs that merely mention the same words.

## Acceptance criteria
- [x] Sanitized notebook-derived English/Indonesian and history cases written before the change
- [x] Evaluate handoff relevance prior and report lexical/hybrid notebook and medium deltas
- [x] Default context baseline and medium answer support recall do not regress

## Notes
Implemented in PR #53. Search applies handoff prior 0.5 after fusion; explicit history terms retain prior 1. Notebook Indonesian test question improves ninth to first; two additional questions improve eighth to second and fifth to third. History ordering unchanged. Ten answer candidate selections deliberately change, support recall unchanged. Real 22-case Sonnet citation precision 0.6500 versus earlier 0.6250, errors 0; one stochastic comparison is not a general gain claim. See docs/12 section 3.3 and docs/15 section 7. Lint/typecheck, 846 tests (one skipped), strict validation and both deterministic evals pass. Merged in PR #53 after all six OS/Node checks passed. Final suite including the optional-runtime test repair: 848 passed, one skipped. Context scoring and T7 target unchanged.
