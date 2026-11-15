---
aimem: 1
id: tsk-4gt7sd44
type: task
title: "T2: CLI LLM provider (Claude Code print mode)"
summary: Add a generation provider that shells out to claude -p, behind retrieval.llm.
status: review
trust: agent
roles: [all]
paths: [packages/schema/src/project.ts, packages/core/src/, docs/03-spec-file-format.md, docs/14-decisions-and-open-questions.md, docs/15-retrieval-and-rag.md]
author: agent:claude-code
created: 2026-11-15T17:27:19Z
updated: 2026-11-15T17:54:50Z
priority: p1
---

## Goal
Give aimem a local LLM path that reuses the user's Claude Code login, with no API key in aimem. Optional; default stays none. Decision goes in docs/14 as an ADR; config in docs/03 §6 and docs/15 §11.

## Acceptance criteria
- [x] Tools disabled (verify --tools with empty value): real call reported NONE
- [x] Session persistence off (--no-session-persistence): no new entry in ~/.claude/projects
- [x] --bare behavior confirmed and documented: not used, because it ignores the OAuth login (ADR-017)
- [x] Timeout; errors mapped to AimemError (LLM_FAILED, exit 4)
- [x] Tests use a fake process runner; no real calls
- [x] ADR entry added in docs/14 (ADR-017)

## Notes
Branch feat/t2-cli-llm-provider. Off until retrieval.llm.allow_remote: true. Set retrieval.llm.model, because --setting-sources "" skips the user's default model.
