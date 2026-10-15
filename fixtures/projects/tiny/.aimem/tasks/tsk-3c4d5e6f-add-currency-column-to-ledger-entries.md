---
aimem: 1
id: tsk-3c4d5e6f
type: task
title: Add currency column to ledger entries
summary: Migrate ledger_entries to integer minor units with a non-null currency column.
status: in_progress
trust: verified
roles: [dev, db]
tags: [money, migration]
paths: [db/migrations/**, src/ledger/entries.ts]
author: human:dana
created: 2026-09-15T08:00:00Z
updated: 2026-10-08T16:20:00Z
verified: 2026-09-15
links: [dec-1a2b3c4d]
assignee: dana
priority: p1
---

## Goal
Every ledger entry stores `amount_minor` and `currency`; the old float column is gone.

## Acceptance criteria
- [x] Migration adds `amount_minor BIGINT` and `currency CHAR(3)`
- [ ] Backfill converts existing rows without loss
- [ ] Float column dropped after backfill check

## Notes
Backfill must run in batches of 10k rows to stay under the lock timeout.
