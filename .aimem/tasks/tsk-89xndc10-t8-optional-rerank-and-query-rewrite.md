---
aimem: 1
id: tsk-89xndc10
type: task
title: "T8: Optional rerank and query rewrite"
summary: Better ranking for hard questions, opt-in only.
status: done
trust: agent
roles: [all]
paths: [packages/core/src/, packages/schema/src/project.ts]
author: agent:claude-code
created: 2026-11-15T17:27:23Z
updated: 2026-11-17T22:08:26Z
priority: p3
---

## Goal
Provide opt-in local cross-encoder reranking and LLM query reformulation, preserving existing default retrieval and fallback behavior.

## Acceptance criteria
- [x] Default retrieval.rerank and query_rewrite remain none
- [x] Eval deltas recorded for model and retrieval changes
- [x] Offline default path unchanged; unavailable providers retain preceding retrieval
- [x] T2 provider reused; proceeding independently of unfinished T7 was approved in docs/18

## Notes
Implementation merged in PRs #39-#45 after all six OS/Node checks passed. Real-answer evidence is in PR #48 and docs/19. Core, CLI and MCP share rewriting/local ranking; explicit index --reranker setup and cached-only doctor checks are included. BGE is the optional ranker, with measured keyword/latency tradeoffs. The 22-case real answer comparison completed after login: citation precision baseline 0.6250, rewrite 0.5952, local ranking 0.5435; zero provider errors, refusal 1.0, trap-win 0. Local ranking also reduced answerable support recall. Keep both options disabled by default; no general answer-quality improvement is claimed. See docs/19. context --deep remains a separate reserved feature.
