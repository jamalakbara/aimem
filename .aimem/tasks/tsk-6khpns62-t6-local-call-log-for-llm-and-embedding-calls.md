---
aimem: 1
id: tsk-6khpns62
type: task
title: "T6: Local call log for LLM and embedding calls"
summary: Trace each LLM and embedding call without storing record text by default.
status: open
trust: agent
roles: [all]
paths: [packages/core/src/, packages/cli/src/commands/embedder.ts]
author: agent:claude-code
created: 2026-11-15T17:27:22Z
updated: 2026-11-15T17:27:22Z
priority: p2
---

## Goal
Make generation and embedding calls debuggable and budgetable, offline, with no record content stored unless the user opts in.

## Acceptance criteria
- [ ] JSON-lines log: time, provider, model, latency, token counts if returned, ref count
- [ ] No record content unless opted in
- [ ] doctor reports log location and what it contains
- [ ] Depends on T2 (embedding calls may start earlier)

## Notes
none
