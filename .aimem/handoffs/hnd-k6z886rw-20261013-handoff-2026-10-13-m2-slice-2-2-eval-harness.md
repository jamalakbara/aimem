---
aimem: 1
id: hnd-k6z886rw
type: handoff
title: "Handoff 2026-10-13: M2 slice 2.2 eval harness"
summary: "Done: M2 slice 2.2 eval harness · Next: Slice 2.3: chunking + embeddings behind an interface, deterministic stub embedder for tests, lexical fallback, vector cache."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-13T08:04:00Z
updated: 2026-10-13T08:04:00Z
branch: feat/m2-evals
---

## Done
- `fixtures/evals/medium.yaml`: 24 cases (8 keyword, 6 paraphrase, 6 multilingual, 4 trap), committed **before** the first run.
- core `eval/run.ts` `runEvalSet`: recall@k, shown-in-briefing, violations, budget, determinism, unlabelled inferred/stale; per-category and overall summaries.
- `pnpm eval` (`scripts/eval.mjs`): table + deltas vs `fixtures/evals/baseline/medium.lexical.json`; `--update-baseline`.
- Gates in tests: keyword recall@10 ≥ 0.85, 0 violations, budget 100%, deterministic, labelled; results must equal the baseline (mutation: changing weights fails both).
- **Lexical baseline:** keyword 1.00 · trap 1.00 · paraphrase 0.75 · multilingual 0.67 · overall 0.854; 0 violations.

## Not done
- Hard cases: several paraphrase/multilingual cases share words with their records (e.g. "index"/"edit" are the same in Indonesian notes), so they are easier than intended. Add harder cases (no shared tokens) before 2.4 so hybrid's gain is measured honestly.

## Next
- Slice 2.3: chunking + embeddings behind an interface, deterministic stub embedder for tests, lexical fallback, vector cache.

## Blocked
- none

## Notes for next agent
- Misses: para-lint-silent (mem-rj2t0xj9), para-who-is-working (mem-peqcrkme), ml-id-agent-commit (dec-ek66gxgx), ml-id-delete (dec-b0gymeq0).
