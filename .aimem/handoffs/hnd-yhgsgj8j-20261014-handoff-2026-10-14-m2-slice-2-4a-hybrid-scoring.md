---
aimem: 1
id: hnd-yhgsgj8j
type: handoff
title: "Handoff 2026-10-14: M2 slice 2.4a hybrid scoring"
summary: "Done: M2 slice 2.4a hybrid scoring · Next: Plan/build 2.4b."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-14T08:01:00Z
updated: 2026-10-14T08:01:00Z
branch: feat/m2-hybrid
---

## Done
- 10 hard eval cases (no shared content words) committed **before** any run; eval set now 34 cases.
- core: `SemanticInput` into `context` scoring (0.25 lexical + 0.25 semantic, semantic top-50 candidates, hard filters first), `rrf` fusion option, header `on (model, coverage)` / `off (reason)`, chain-head link expansion (15 §8 rule 1), exported `buildQuery`; `semanticForQuery` (scores + coverage or reason; cache meta now lists excluded refs); hybrid `search(…, semantic)`; `runEvalSet` async with optional semantic provider.
- CLI: `--mode` defaults to `retrieval.mode` (else hybrid) for `context` and `search`; falls back to lexical with a reason; warns only when hybrid was explicit. Contracts/golden updated deliberately (header line, reason fields, `semantic: 0` parts — no ranking changes).
- Lexical-only results proven unchanged: the original 24 eval cases are identical to the previous baseline. New lexical baseline (34 cases): keyword 1.00 · trap 1.00 · paraphrase 0.77 · multilingual 0.64 · overall 0.809.
- Mutation: removing chain-head expansion is caught.

## Not done
- Real local model + model comparison (OQ-16), `openai-compatible` provider, real-model eval vs lexical (M2 gate), CI job for real-model evals.

## Next
- Plan/build 2.4b.

## Blocked
- none

## Notes for next agent
- The stub embedder measures word overlap, so stub-hybrid eval numbers mean nothing for quality; only the smoke properties (budget, determinism, violations) are asserted.
