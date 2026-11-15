---
aimem: 1
id: tsk-4gt7sd44
type: task
title: "T2: CLI LLM provider (Claude Code print mode)"
summary: Add a generation provider that shells out to claude -p, behind retrieval.llm.
status: open
trust: agent
roles: [all]
paths: [packages/schema/src/project.ts, packages/core/src/, docs/03-spec-file-format.md, docs/14-decisions-and-open-questions.md, docs/15-retrieval-and-rag.md]
author: agent:claude-code
created: 2026-11-15T17:27:19Z
updated: 2026-11-15T17:27:19Z
priority: p1
---

## Goal
Give aimem a local LLM path that reuses the user's Claude Code login, with no API key in aimem. Optional; default stays none. Decision goes in docs/14 as an ADR; config in docs/03 §6 and docs/15 §11.

## Acceptance criteria
- [ ] Tools disabled (verify --tools with empty value)
- [ ] Session persistence off (--no-session-persistence)
- [ ] --bare behavior confirmed and documented
- [ ] Timeout; errors mapped to AimemError
- [ ] Tests use a fake process runner; no real calls
- [ ] ADR entry added in docs/14

## Notes
none
