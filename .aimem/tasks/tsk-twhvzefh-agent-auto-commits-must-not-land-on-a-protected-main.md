---
aimem: 1
id: tsk-twhvzefh
type: task
title: Agent auto-commits must not land on a protected main
summary: write_policy commit puts agent notes on whatever branch is checked out, including main, which the playbook forbids for agents.
status: open
trust: agent
roles: [dev]
tags: [git, write-policy, dogfood]
paths: [packages/core/src/ops/policy.ts]
author: agent:claude-code
created: 2026-10-18T15:42:38Z
updated: 2026-10-18T15:42:38Z
priority: p2
---

## Goal
Agent writes in a repo with a protected/no-agent main never create commits on main.

## Acceptance criteria
- [ ] Decide the behaviour (e.g. stage instead of commit on the default branch, or commit notes to a side branch) and document it in docs/03 §6 / docs/04
- [ ] Tests with a real temp repo on main and on a feature branch

## Notes
Found 2026-10-18: recording two notes would have auto-committed straight to main (solo mode → commit); worked around by recording them on a branch with a PR. Related: OQ-4 (team default is stage).
