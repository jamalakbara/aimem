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
updated: 2026-11-17T17:24:41Z
priority: p2
---

## Goal
Improve default offline paraphrase retrieval without regressing keyword cases or weakening trust/freshness rules.

## Acceptance criteria
- [ ] Paraphrase set reaches +0.15 over lexical
- [x] Keyword set does not regress (shipped defaults unchanged)
- [x] Eval deltas recorded in PRs
- [x] Model experiments include before/after evidence

## Notes
Still open. Default MiniLM paraphrase recall is 0.8636 vs lexical 0.7727 (+0.0909). Corpus-mean centering did not improve the original set. E5-base regressed paraphrase recall to 0.7727; it was not shipped. Six additional questions were written before experiments. All original expected refs appear somewhere in the medium briefing, but the top-10 scoring target remains unmet. See docs/15 sections 4.2 and 9, fixtures/evals/results/t7-centering.json and t7-e5-base.json, PRs #38 and #47. Optional T8 ranking does not close T7.
