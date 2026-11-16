---
aimem: 1
id: hnd-9dwpvcab
type: handoff
title: "Handoff 2026-11-16: Reproduced real MiniLM baseline: paraphrase 0.8636 vs lexical 0.7727, keyword 1.0, multilingual 0.9…"
summary: "Done: Reproduced real MiniLM baseline: paraphrase 0.8636 vs lexical 0.7727, keyword 1.0, multilingual 0.9091. Tested RRF, weight shifts, chunk formats, query cleanup and fp32; no safe +0.15 gain. Rec…"
status: final
trust: agent
roles: [all]
author: agent:codex
created: 2026-11-16T14:05:31Z
updated: 2026-11-16T14:05:31Z
task: tsk-31rbbwr6
branch: codex/t7-paraphrase-retrieval
---

## Done
Reproduced real MiniLM baseline: paraphrase 0.8636 vs lexical 0.7727, keyword 1.0, multilingual 0.9091. Tested RRF, weight shifts, chunk formats, query cleanup and fp32; no safe +0.15 gain. Recorded results and miss ranks in docs/15. Existing real-model gate, lint and diff check pass.

## Not done
T7 target remains unmet; no scorer, cache format, model default or evaluation case changes shipped. Temporary stricter gate correctly failed and was reverted.

## Next
Review experiment evidence. Consider an approved T8 reranking/query-rewrite slice with independent eval cases, or further model research. Do not mark T7 done or change metrics to manufacture success.

## Blocked
No candidate meets the accepted quality target yet.

## Notes for next agent
Default q8 model and optional fp32 comparison model are now cached locally. Current hybrid already includes all expected records in packed briefings; misses concern score-order recall at 10.
