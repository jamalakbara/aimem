---
aimem: 1
id: tsk-31rbbwr6
type: task
title: "T7: Paraphrase retrieval gain to +0.15"
summary: Close the paraphrase gap from +0.09 to the +0.15 target over lexical.
status: open
trust: agent
roles: [all]
paths: [packages/core/src/context/score.ts, packages/core/src/embed/chunk.ts, packages/core/src/search/, fixtures/evals/]
author: agent:claude-code
created: 2026-11-15T17:27:23Z
updated: 2026-11-15T17:27:23Z
priority: p2
---

## Goal
Improve semantic ranking for paraphrased questions (docs/15 §4.2, §6, §7) without regressing keyword cases. Tune fusion, chunking, or query construction, measured by eval.

## Acceptance criteria
- [ ] Paraphrase set reaches +0.15 over lexical
- [ ] Keyword set does not regress
- [ ] Eval deltas in the PR
- [ ] Weight or model change needs an eval delta

## Notes
none
