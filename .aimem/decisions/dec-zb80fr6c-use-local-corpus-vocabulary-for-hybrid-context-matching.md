---
aimem: 1
id: dec-zb80fr6c
type: decision
title: Use local corpus vocabulary for hybrid context matching
summary: Keep MiniLM and add bounded cached word matching with complete-score fusion; T7 reaches +0.1818 without default LLM rewriting or reranking.
status: accepted
trust: agent
roles: [all]
tags: [retrieval, context, local]
paths: [packages/core/src/context/**, packages/core/src/embed/**]
author: agent:codex
created: 2026-11-18T14:07:40Z
updated: 2026-11-18T14:07:40Z
links: [tsk-31rbbwr6]
---

## Decision
Keep the existing local multilingual MiniLM weights and add bounded corpus-vocabulary matching to default hybrid context. Cache up to 4096 eligible words; select cosine >= 0.4 and margin >= 0.01, treating attested word forms as one concept only at mutual cosine >= 0.8. Fuse maximum complete context scores while preserving original-query participation, filters, metadata, trust/freshness and pins.

## Reasons
The original fixed paraphrase set now scores 0.9545 versus lexical 0.7727 (+0.1818), meeting T7's +0.15 target while preserving keyword 1.0, multilingual 0.9091 and trap 1.0. All 68 questions preserve/improve set-level recall. The final twelve locked questions remain at 1.0. No new model download or optional LLM/reranker default is required.

## Alternatives and limits
Larger embeddings, score/density/PCA adjustments, shorter passages, token interaction and local-ranker fusion did not meet the original target. Quantized word embeddings must be computed independently to keep incremental reuse stable across unrelated corpus changes. Vocabulary matching remains corpus-dependent and can pick an imperfect word; the small shared-project evaluation is not a generalization claim.

## Operational consequences
PR #56 is merged with six green OS/Node checks and the Linux real-model gate. Cache metadata version 2 adds optional term rows; run aimem index --embeddings after upgrading. Old caches still read with prior behavior; older CLIs fall back lexically on the new cache. Model, record format, JSON envelopes and LLM rewriting/reranking defaults remain unchanged. See docs/15 section 7 and fixtures/evals/results/t7-final.json.
