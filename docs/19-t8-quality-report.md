# T8 quality and validation

Measured 2026-11-18 on synthetic fixtures. Defaults remain
`query_rewrite: none` and `rerank: none`; default embedding retrieval is unchanged.

## Local cross-encoder comparison

`node scripts/eval-local-ranker.mjs --model=<minilm|bge> --download` uses actual
context ranking and budget packing, 50 eligible candidates, trust/freshness
policy and cached MiniLM embeddings. Omit `--download` after setup. Relevance
scores are min-max normalized before context metadata boosts are applied;
without normalization narrow logit bands let metadata swamp relevance.

| Set/category | Original hybrid | MiniLM ranker | BGE ranker |
|---------------|-----------------|---------------|------------|
| Medium overall, 34 questions | 0.9265 | 0.8382 | 0.9118 |
| Medium keyword | 1.0000 | 1.0000 | 0.9375 |
| Medium paraphrase | 0.8636 | 0.7727 | 0.8636 |
| Medium multilingual | 0.9091 | 0.7273 | 0.9091 |
| Medium trap | 1.0000 | 1.0000 | 1.0000 |
| Additional questions overall, 6 questions | 0.4167 | 0.4167 | 0.7500 |

BGE is selected for the **optional** local ranker because it performs better on
the additional questions and regresses fewer original cases than MiniLM. This
does not establish a universal gain: it loses one of the two expected refs in
`kw-claims-cas`, and the original hybrid remains better overall on medium.
Do not enable it by default. The quantized ONNX file is about 571 MB, compared
with about 118 MB for the small candidate. Observed BGE inference was roughly
5–15 seconds per query on this Windows machine, including concurrent test load;
these timings are not isolated performance benchmarks.

Both runs had full budget compliance and zero forbidden refs. Raw per-case
results, latency and setup timing are in `fixtures/evals/results/local-ranker-*.json`.
The six questions were written before the initial T7 runs; later model comparisons
reuse them, so this is a small shared-corpus comparison, not independent evidence
of generalization. Local ranking does not satisfy T7's default offline target.

## Real generated answers

`node scripts/eval-retrieval-options.mjs --real` compares the existing 22 answer
cases with baseline, query rewriting and local ranking. It uses Claude Code
login, strips the API-key environment variable, requires cached BGE, and measures
the existing citation/refusal/trap/injection metrics. It uses lexical candidate
retrieval to isolate the optional features from embedding changes.

The first attempt was blocked by authentication. After the user signed in, a
fresh provider preflight and all three complete modes succeeded with zero errors.
The runner checks provider readiness before a batch and aborts comparisons on
provider errors. Full answers and per-case metrics are in
`fixtures/evals/results/ask-retrieval-options.json`.

| Metric | Baseline | Query rewriting | Local BGE reranking |
|--------|----------|-----------------|---------------------|
| Support-list citation precision | 0.6250 | 0.5952 | 0.5435 |
| Answerable support retrieval recall | 0.9375 | 0.9375 | 0.8750 |
| Multilingual support retrieval recall | 1.0000 | 1.0000 | 1.0000 |
| Trap support retrieval recall | 0.9000 | 0.9000 | 0.9000 |
| Unanswerable refusal rate | 1.0000 | 1.0000 | 1.0000 |
| Trap-win rate | 0.0000 | 0.0000 | 0.0000 |
| Marker-based injection resistance | 0.5000 | 1.0000 | 1.0000 |
| Provider errors | 0 | 0 | 0 |
| Total seconds, 22 cases | 86.1 | 160.0 | 239.5 |

Neither feature improved answer citation precision in this run; local reranking
also lost answerable evidence. Keep them opt-in and do not recommend enabling
either as a blanket quality improvement. Citation precision is the existing
support-list proxy, not a claim-by-claim factuality judgment. This is one run per
mode over the same cases and model alias, not repeated evidence of stability.

The baseline's marker test flagged `inj-release-checklist` because its answer
quoted the malicious marker while explicitly rejecting the instruction. The
metric is retained unchanged: this distinguishes marker emission from evidence
that an instruction was followed. No tool execution is available in these calls.

Unit and integration tests verify consent, bounded inputs, invalid response
fallback, hard filters, privacy exclusions, unchanged default contracts, and
metadata-only call logging across core, CLI and MCP. Default lexical briefing
and fake-answer eval baselines remain unchanged. Generated-answer deltas are now
measured, with the regressions and limitations above retained for review.
