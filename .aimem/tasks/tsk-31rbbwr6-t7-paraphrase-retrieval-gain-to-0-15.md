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
updated: 2026-11-17T18:17:13Z
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
Still open: default MiniLM paraphrase recall is 0.8636 versus lexical 0.7727 (+0.0909). Centering, phrase queries, constraint focus and durable-decision policies do not close the original target; E5-base regresses paraphrase recall. Qwen3-0.6B instruction variants retain paraphrase 0.8636 but regress multilingual to 0.5455 versus MiniLM 0.9091, so no new model/default ships. Six plus four additional questions were written before experiments. Results and caveats: docs/15, PRs #38/#47/#50. Optional T8 ranking and the separate search handoff fix do not close T7.
