---
aimem: 1
id: dec-1a2b3c4d
type: decision
title: Store money as integer minor units
summary: All amounts are stored and computed as integer minor units (cents) with an explicit currency code.
status: accepted
trust: verified
roles: [dev, db, analyst]
tags: [money, ledger, pinned]
paths: [src/ledger/**, db/migrations/**]
author: human:dana
created: 2026-09-14T10:30:00Z
updated: 2026-09-14T10:30:00Z
verified: 2026-09-14
links: [tsk-3c4d5e6f, mem-5e6f7g8h]
supersedes: dec-2b3c4d5e
---

## Context
Float storage produced off-by-one-cent differences between the ledger and bank statements.

## Decision
Use `BIGINT` minor units plus a three-letter `currency` column. Convert only at the API edge.

## Consequences
Every amount needs a currency. Division (splits, fees) must use the shared rounding helper.

## Alternatives
Decimal columns: exact, but slower in our reporting queries and awkward in JavaScript.
