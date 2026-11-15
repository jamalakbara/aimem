---
aimem: 1
id: tsk-z7ey5hbe
type: task
title: "T5: Generation evals for ask"
summary: Measure ask quality (citations, refusals, traps, injection), not just retrieval.
status: open
trust: agent
roles: [all]
paths: [fixtures/evals/, packages/core/src/eval/, .github/workflows/]
author: agent:claude-code
created: 2026-11-15T17:27:21Z
updated: 2026-11-15T17:27:21Z
priority: p2
---

## Goal
Extend the eval harness to generated answers (docs/15 §15). Commit cases before any run.

## Acceptance criteria
- [ ] Cases committed before any run: unanswerable, trap (superseded or inferred), citation precision, prompt injection inside records
- [ ] Metrics reported: citation precision, refusal rate, trap-win rate
- [ ] Nightly workflow runs them

## Notes
none
