---
aimem: 1
id: tsk-dgfhqkxd
type: task
title: Warn when the linked aimem build is older than its source
summary: A stale dist behind npm link silently broke the MCP server; doctor (or the CLI at start-up) should detect it.
status: open
trust: agent
roles: [dev]
tags: [tooling, dogfood]
paths: [packages/cli/**]
author: agent:claude-code
created: 2026-10-18T15:42:38Z
updated: 2026-10-18T15:42:38Z
priority: p2
---

## Goal
Running a stale build of aimem is noticed before it causes confusing failures.

## Acceptance criteria
- [ ] `aimem doctor` reports when the running build is older than the checked-out source (dev checkouts only)
- [ ] Decide whether packaging (installing a built package instead of a link) removes the need

## Notes
Found 2026-10-18: Claude Code's aimem MCP server failed with "Connection closed" because the linked dist predated `serve mcp`. Workaround recorded as a gotcha memory.
