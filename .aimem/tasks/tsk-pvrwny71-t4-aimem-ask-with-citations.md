---
aimem: 1
id: tsk-pvrwny71
type: task
title: "T4: aimem ask with citations"
summary: Answer a question from retrieved records, citing refs, and refusing when evidence is weak.
status: review
trust: agent
roles: [all]
paths: [packages/cli/src/commands/, docs/04-cli-reference.md, docs/15-retrieval-and-rag.md]
author: agent:claude-code
created: 2026-11-15T17:27:21Z
updated: 2026-11-15T18:04:59Z
priority: p1
---

## Goal
Core of the Q&A feature (docs/15 §10). Answers only from retrieved records, cites every claim as [ref], says not found when evidence is weak, never writes records, never uses tools.

## Acceptance criteria
- [x] Records wrapped in <aimem-record> tags with trust attribute
- [x] No tool use (claude-cli runs with --tools ""; ask never writes)
- [x] Output: answer + Sources (ref, title, trust) + confidence note
- [x] --json contract documented in docs/04 (contract, changes only on purpose)
- [x] Not-found path tested (zero matches: no LLM call; model says not found)
- [x] allow_remote gate and no-embed respected (secret-flagged records also excluded)

## Notes
Branch feat/t4-ask-with-citations. Not checked with a real model (fake LLM only); answer quality is T5.
