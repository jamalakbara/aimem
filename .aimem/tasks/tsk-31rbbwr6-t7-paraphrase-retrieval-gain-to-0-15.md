---
aimem: 1
id: tsk-31rbbwr6
type: task
title: "T7: Paraphrase retrieval gain to +0.15"
summary: Default local hybrid context gains +0.1818 paraphrase recall over lexical, meeting the +0.15 target.
status: done
trust: agent
roles: [all]
paths: [packages/core/src/context/score.ts, packages/core/src/embed/chunk.ts, packages/core/src/search/, fixtures/evals/]
author: agent:claude-code
created: 2026-11-15T17:27:23Z
updated: 2026-11-18T14:07:37Z
priority: p2
---

## Goal
Improve default offline paraphrase retrieval without regressing keyword cases or weakening trust/freshness rules.

## Acceptance criteria
- [x] Original frozen paraphrase set gains at least +0.15 over lexical: 0.9545 versus 0.7727 (+0.1818)
- [x] Keyword recall stays 1.0; multilingual stays 0.9091 versus lexical 0.6364; trap recall stays 1.0
- [x] Eval deltas and per-case evidence recorded in PR #56 and fixtures/evals/results/t7-final.json
- [x] Rejected model/scoring experiments recorded; the existing local MiniLM model remains default

## Notes
Merged in PR #56 after all six OS/Node checks passed; the stricter real-model gate also passed on Linux in run 44319378283. Local context matches a confident cached corpus word, groups attested embedding-aligned word forms, and max-fuses complete scoring views. No curated synonym/ref map, LLM generation or cross-encoder is enabled. The 68 fixed questions retain budget compliance, determinism and zero forbidden refs. Twelve final validation questions were committed before first evaluation and stayed at recall 1.0. Full suite: 864 passed, one skipped; real-model gate passed separately; lexical context and fake-answer baselines unchanged. Version-2 local caches need index --embeddings after upgrade; legacy caches retain prior behavior, older CLIs fall back lexically. This workspace's local cache is rebuilt with coverage 100%. See docs/15 section 7 for costs, confidence limits and the remaining ownership-memory miss; meeting the target does not imply perfect retrieval.
