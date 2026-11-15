---
aimem: 1
id: mem-t0h5xx2c
type: memory
title: ask hides rejected decisions, so 'can I…' questions can miss the answer
summary: ask uses search's default hidden statuses; a rejected decision (e.g. dec-awbwfz2n, private records) is only retrieved for why/before questions.
status: active
trust: agent
roles: [all]
tags: [ask, retrieval, evals]
paths: [packages/core/src/ask/**]
author: agent:claude-code
created: 2026-11-15T18:16:25Z
updated: 2026-11-15T18:16:25Z
---

## Notes
- Found by the T5 eval case `ans-private-notes` ("Can I keep private notes…?"): the answering record is the rejected decision dec-awbwfz2n, and `ask` only adds hidden statuses (superseded, rejected, …) for historical questions (15 §10).
- Possible fix: treat `rejected` decisions as answerable evidence ("we decided not to"), while keeping `superseded` out. Not done; it changes retrieval, so it needs eval deltas.
