---
aimem: 1
id: hnd-k7q8wkpf
type: handoff
title: "Handoff 2026-11-18: Completed and merged T7 in PR #56 after all six OS/Node checks passed; Linux real-model workflow 44…"
summary: "Done: Completed and merged T7 in PR #56 after all six OS/Node checks passed; Linux real-model workflow 44319378283 also passed. Default local corpus-vocabulary matching raises original paraphrase rec…"
status: final
trust: agent
roles: [all]
author: agent:codex
created: 2026-11-18T14:07:47Z
updated: 2026-11-18T14:07:47Z
task: tsk-31rbbwr6
---

## Done
Completed and merged T7 in PR #56 after all six OS/Node checks passed; Linux real-model workflow 44319378283 also passed. Default local corpus-vocabulary matching raises original paraphrase recall to 0.9545 versus lexical 0.7727 (+0.1818), retaining keyword 1.0, multilingual 0.9091 and trap 1.0. All 68 fixed questions preserve/improve set-level recall, budget compliance, determinism and zero forbidden refs; final twelve locked questions remain at 1.0. Full suite: 864 passed, one skipped; the stricter real-model gate passed separately. Lexical and fake-answer baselines unchanged. All twelve tracked tasks are done. Rebuilt this notebook local cache; doctor reports semantic coverage 100% and a fresh development build.

## Not done
No unfinished task in the original T1-T9 plus three dogfood records. The larger M3-M7 roadmap is future scope. Three pre-existing untracked handoffs and their working INDEX entries remain uncommitted.

## Next
Plan the earliest unfinished milestone in docs/13 (M3 team claims) and obtain its required plan approval before implementation. Keep optional LLM rewriting and local reranking disabled by default.

## Blocked
none

## Notes for next agent
T7 uses the existing MiniLM weights, no curated synonyms or fixture IDs. Cache metadata v2 / chunker v2 adds at most 4096 corpus words. Word vectors are computed independently to avoid quantized batch-composition drift and reused by word across source changes. Context max-fuses complete original/word views; status, repo, privacy, trust/freshness and pins remain enforced. Run aimem index --embeddings after upgrading; old caches retain prior behavior and older CLIs fall back lexically. Search/ask ranking paths are unchanged. See docs/15 section 7 and fixtures/evals/results/t7-final.json. The ownership-memory miss still exists; benchmark completion is not perfect/general retrieval. Larger models, calibrations, passages, token matching and ranker fusion were rejected; local scratch archive is recorded in .aimem/.cache/t7-research-archive-path.txt. If doctor still warns after pnpm build, pnpm exec tsc -b --force cleared observed mtime warnings.
