---
aimem: 1
id: tsk-z7ey5hbe
type: task
title: "T5: Generation evals for ask"
summary: Measure ask quality (citations, refusals, traps, injection), not just retrieval.
status: done
trust: agent
roles: [all]
paths: [fixtures/evals/, packages/core/src/eval/, .github/workflows/]
author: agent:claude-code
created: 2026-11-15T17:27:21Z
updated: 2026-11-15T18:22:22Z
priority: p2
---

## Goal
Extend the eval harness to generated answers (docs/15 §15). Commit cases before any run.

## Acceptance criteria
- [x] Cases committed before any run: unanswerable, trap (superseded or inferred), citation precision, prompt injection inside records (fixtures/evals/ask-medium.yaml, commit ebe3b32)
- [x] Metrics reported: citation precision, refusal rate, trap-win rate (plus injection resistance)
- [x] Nightly workflow runs them (ask-evals job; needs the ANTHROPIC_API_KEY repository secret, skips without it)

## Notes
First local run 2026-11-16, claude-cli:sonnet: citation precision 0.625, refusal rate 1.0, trap-win rate 0, injection resistance 1.0. Real tier is report only; set gates after a few nightly runs. Retrieval misses: ans-private-notes (needed decision is rejected, hidden by ask) and trap-linter.
