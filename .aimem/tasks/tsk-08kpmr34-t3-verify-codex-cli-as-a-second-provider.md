---
aimem: 1
id: tsk-08kpmr34
type: task
title: "T3: Verify Codex CLI as a second provider"
summary: Decide whether Codex can serve as a second CLI LLM provider.
status: open
trust: agent
roles: [all]
paths: [docs/14-decisions-and-open-questions.md]
author: agent:claude-code
created: 2026-11-15T17:27:20Z
updated: 2026-11-15T17:27:20Z
priority: p2
---

## Goal
Research task. Codex CLI is not installed in the dev environment, so its non-interactive flags are unverified. Produce a go/no-go with flags confirmed by running them.

## Acceptance criteria
- [ ] Install Codex; run codex exec --help and a real non-interactive call
- [ ] Confirm tool disabling, session persistence, output format
- [ ] Written go/no-go note with exact flags used

## Notes
none
