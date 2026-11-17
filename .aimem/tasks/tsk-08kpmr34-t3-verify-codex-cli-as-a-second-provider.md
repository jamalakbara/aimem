---
aimem: 1
id: tsk-08kpmr34
type: task
title: "T3: Verify Codex CLI as a second provider"
summary: Decide whether Codex can serve as a second CLI LLM provider.
status: done
trust: agent
roles: [all]
paths: [docs/14-decisions-and-open-questions.md]
author: agent:claude-code
created: 2026-11-15T17:27:20Z
updated: 2026-11-17T18:17:14Z
priority: p2
---

## Goal
Decide whether Codex CLI can serve as a second login-based LLM provider.

## Acceptance criteria
- [x] Inspect installed Codex; run exec help and real non-interactive calls
- [x] Investigate tool disabling, session persistence and output format; tool-free operation remains unverified
- [x] Written go/no-go note with exact flags in docs/14

## Notes
Research completed and merged in PR #34. Tested desktop-bundled 0.169.0-alpha.11.1 on Windows. ChatGPT login works without API-key environment variables, JSONL includes usage, and ephemeral calls created no session transcripts. No-go for provider implementation until zero-tool operation is verifiable: model reports tools despite switches, while JSONL does not prove execution either way. Keep Claude Code for local real-model evals. See docs/14 T3 for evidence and limitations. Done means the feasibility decision is complete, not that a Codex provider shipped.
