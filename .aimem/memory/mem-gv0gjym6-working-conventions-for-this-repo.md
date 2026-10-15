---
aimem: 1
id: mem-gv0gjym6
type: memory
title: Working conventions for this repo
summary: Plan first and wait for approval, one slice per PR, tests first, spec 03 is the contract, contract snapshots change only on purpose, end every session with aimem handoff.
status: active
trust: agent
roles: [all]
tags: [pinned]
author: agent:claude-code
created: 2026-10-15T02:56:05Z
updated: 2026-10-15T02:56:05Z
kind: preference
---

From AGENTS.md and docs/17:
- Plan each slice before coding and wait for the human's approval; explain choices in plain words and ask few questions.
- One slice per PR on its own branch; tests first; run lint, typecheck and tests before committing.
- `docs/03` is the contract: no invented fields or statuses; change the spec in the same PR when needed.
- `--json` output, error codes and exit codes are contracts: saved contract files change only deliberately, and the PR says so.
- Side effects (fs, git, clock, random, network) are injected; only core/git spawns processes.
- Never put secrets or personal data in fixtures, docs or records.
- End every session with `aimem handoff` (Done / Not done / Next / Blocked).
