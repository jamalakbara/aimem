---
aimem: 1
id: tsk-pvrwny71
type: task
title: "T4: aimem ask with citations"
summary: Answer a question from retrieved records, citing refs, and refusing when evidence is weak.
status: open
trust: agent
roles: [all]
paths: [packages/cli/src/commands/, docs/04-cli-reference.md, docs/15-retrieval-and-rag.md]
author: agent:claude-code
created: 2026-11-15T17:27:21Z
updated: 2026-11-15T17:27:21Z
priority: p1
---

## Goal
Core of the Q&A feature (docs/15 §10). Answers only from retrieved records, cites every claim as [ref], says not found when evidence is weak, never writes records, never uses tools.

## Acceptance criteria
- [ ] Records wrapped in <aimem-record> tags with trust attribute
- [ ] No tool use
- [ ] Output: answer + Sources (ref, title, trust) + confidence note
- [ ] --json contract documented in docs/04 (contract, changes only on purpose)
- [ ] Not-found path tested
- [ ] allow_remote gate and no-embed respected

## Notes
none
