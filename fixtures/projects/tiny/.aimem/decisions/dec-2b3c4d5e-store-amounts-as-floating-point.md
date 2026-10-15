---
aimem: 1
id: dec-2b3c4d5e
type: decision
title: Store amounts as floating point
summary: Early prototype kept ledger amounts in double-precision floats for simplicity.
status: superseded
trust: verified
roles: [dev, db]
tags: [money, ledger]
paths: [src/ledger/**]
author: human:dana
created: 2026-08-03T09:00:00Z
updated: 2026-09-14T10:30:00Z
verified: 2026-08-03
superseded_by: dec-1a2b3c4d
---

## Context
The prototype needed a working ledger quickly and floats were the default numeric type.

## Decision
Keep amounts as `REAL` columns and `number` values in code.

## Consequences
Rounding drift appeared in monthly totals; replaced by integer minor units.
