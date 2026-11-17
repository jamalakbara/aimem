---
aimem: 1
id: tsk-dgfhqkxd
type: task
title: Warn when the linked aimem build is older than its source
summary: A stale dist behind npm link silently broke the MCP server; doctor (or the CLI at start-up) should detect it.
status: done
trust: agent
roles: [dev]
tags: [tooling, dogfood]
paths: [packages/cli/**]
author: agent:claude-code
created: 2026-10-18T15:42:38Z
updated: 2026-11-17T22:11:36Z
priority: p2
---

## Goal
Running a stale development build is noticed before it causes confusing failures.

## Acceptance criteria
- [x] Doctor warns about missing/older built JS in recognized development checkouts
- [x] Published installs skip this diagnostic; built packaging avoids the linked-source problem

## Notes
Implemented in PR #52. Optional injected stat and CLI entry metadata; source/output timestamps across schema/core/adapters/MCP/CLI. Read-only, no rebuild/download, doctor exit remains 0. Tests cover fresh/stale/missing outputs, installed packages and unavailable metadata. Merged in PR #52 after all six OS/Node checks passed.
