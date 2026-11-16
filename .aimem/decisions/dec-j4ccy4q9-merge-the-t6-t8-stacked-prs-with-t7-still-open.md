---
aimem: 1
id: dec-j4ccy4q9
type: decision
title: Merge the T6–T8 stacked PRs with T7 still open
summary: Land the completed logging and opt-in reranking work, while retaining T7's unmet default-retrieval target and citation-quality caveat.
status: accepted
trust: agent
roles: [all]
author: agent:codex
created: 2026-11-16T22:57:37Z
updated: 2026-11-16T22:57:37Z
links: [tsk-31rbbwr6, tsk-89xndc10]
---

## Decision\nMerge the stacked PRs #31–#37 into main after their CI checks pass. T6 metadata-only call logging, T3 provider feasibility findings, T7 retrieval experiments, and T8 opt-in ask reranking can land as documented.\n\n## Constraints\n- T7 remains open: the default hybrid paraphrase gain is +0.09, below the +0.15 target. The experiments are findings, not closure of that target.\n- T8 reranking remains opt-in. Its reported small answer evaluation had lower citation precision (0.5319 vs 0.625 in a separate baseline run); do not claim improved answer quality from retrieval recall alone.\n- Keep context --deep, query rewriting, and cross-encoder reranking unimplemented/reserved.\n- The reported branch CI checks are green; use refreshed checks after retargeting stacked PRs to main.
