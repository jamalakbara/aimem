---
aimem: 1
id: tsk-08kpmr34
type: task
title: "T3: Verify Codex CLI as a second provider"
summary: Decide whether Codex can serve as a second CLI LLM provider.
status: review
trust: agent
roles: [all]
paths: [docs/14-decisions-and-open-questions.md]
author: agent:claude-code
created: 2026-11-15T17:27:20Z
updated: 2026-11-16T13:49:48Z
priority: p2
---

## Goal
Decide whether Codex CLI can serve as a second login-based LLM provider.

## Acceptance criteria
- [x] Inspect installed Codex; run exec help and real non-interactive calls
- [x] Investigate tool disabling, session persistence and output format; tool-free operation remains unverified
- [x] Written go/no-go note with exact flags in docs/14

## Notes
Research complete, awaiting review. Tested desktop-bundled 0.169.0-alpha.11.1 on Windows. ChatGPT login works without API-key environment variables, JSONL includes usage, and ephemeral calls created no session transcripts. No-go for provider implementation until zero-tool operation is verifiable: model reports tools despite switches, while JSONL does not prove execution either way. Keep Claude Code for local real-model evals. See docs/14 T3 for evidence and limitations.
