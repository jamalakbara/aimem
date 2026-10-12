---
aimem: 1
id: run-608ahqd1
type: runbook
title: Merge stacked pull requests
summary: Merge a chain of stacked PRs in order, retargeting each to main.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
owner: akbar
---

## When to use
When a slice PR is based on another slice branch.

## Steps
1. Merge the bottom PR into main
2. Retarget the next PR to main
3. Wait for CI
4. Repeat

## Rollback
Revert the merge commit on main.

## Verify
main contains every slice commit; CI green.
