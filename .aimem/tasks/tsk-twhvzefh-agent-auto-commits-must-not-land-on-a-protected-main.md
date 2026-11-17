---
aimem: 1
id: tsk-twhvzefh
type: task
title: Agent auto-commits must not land on a protected main
summary: write_policy commit puts agent notes on whatever branch is checked out, including main, which the playbook forbids for agents.
status: done
trust: agent
roles: [dev]
tags: [git, write-policy, dogfood]
paths: [packages/core/src/ops/policy.ts]
author: agent:claude-code
created: 2026-10-18T15:42:38Z
updated: 2026-11-17T22:11:35Z
priority: p2
---

## Goal
Agent writes on a default branch never create commits there.

## Acceptance criteria
- [x] Stage on main/master/trunk, detached/unknown HEAD and locally identified remote defaults; document in docs/03 and docs/04
- [x] Real temporary git tests cover main and feature branches, custom defaults, explicit overrides and failure cases

## Notes
Implemented in PR #51 under the approved docs/20 plan. Explicit human commits remain supported; agent handoff --commit cannot bypass the guard. No remote fetch or new config keys. CLI staged-result snapshots deliberately updated with unchanged JSON schema and exits. Merged in PR #51 after all six OS/Node checks passed.
