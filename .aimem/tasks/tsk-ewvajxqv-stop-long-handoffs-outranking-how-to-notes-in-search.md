---
aimem: 1
id: tsk-ewvajxqv
type: task
title: Stop long handoffs outranking how-to notes in search
summary: "Dogfooding: questions like how to run tests return long handoff notes before the matching how-to memory."
status: open
trust: agent
roles: [dev]
tags: [search, dogfood]
paths: [packages/core/src/context/**, packages/core/src/search/**]
author: agent:claude-code
created: 2026-10-15T02:59:38Z
updated: 2026-10-15T02:59:38Z
priority: p2
---

## Goal
A how-to or decision that answers the question ranks above handoffs that merely mention the same words.

## Acceptance criteria
- [ ] Add eval cases from this notebook (e.g. "bagaimana cara menjalankan tes?" → the build/test how-to) before changing anything
- [ ] Try a fix (e.g. weight handoffs down in search, or length-normalise more strongly) and show eval deltas
- [ ] No regression on the medium eval set

## Notes
Seen on 2026-10-15 in this repo's own notebook (18 migrated handoffs, 3 memories): "bagaimana cara menjalankan tes?" ranked two handoffs above mem "How to build, test and evaluate"; "apakah boleh menghapus catatan?" also returned handoffs first.
