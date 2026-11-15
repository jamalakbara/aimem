---
aimem: 1
id: tsk-89xndc10
type: task
title: "T8: Optional rerank and query rewrite"
summary: Better ranking for hard questions, opt-in only.
status: open
trust: agent
roles: [all]
paths: [packages/core/src/, packages/schema/src/project.ts]
author: agent:claude-code
created: 2026-11-15T17:27:23Z
updated: 2026-11-15T17:27:23Z
priority: p3
---

## Goal
Add rerank (local cross-encoder) and LLM query rewrite as opt-in features (docs/15 §7, §9). Default stays none; offline path unchanged.

## Acceptance criteria
- [ ] Default retrieval.rerank and query_rewrite stay none
- [ ] Eval delta required per change
- [ ] Offline path unchanged
- [ ] Depends on T2 and T7

## Notes
none
