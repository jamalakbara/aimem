---
aimem: 1
id: tsk-4d5e6f7g
type: task
title: Write rounding tests for fee splits
summary: Property tests proving fee splits always sum back to the original amount.
status: open
trust: agent
roles: [dev, qa]
tags: [money, testing]
paths: [src/ledger/rounding.ts]
author: agent:claude-code
created: 2026-10-08T16:25:00Z
updated: 2026-10-08T16:25:00Z
blocked_by: [tsk-3c4d5e6f]
priority: p2
---

## Goal
Splitting an amount across N parties never loses or invents a cent.

## Acceptance criteria
- [ ] Property test over random amounts and 1–12 parties
- [ ] Remainder cents assigned deterministically to the first parties

## Notes
Wait for the currency migration so tests use the new types.
