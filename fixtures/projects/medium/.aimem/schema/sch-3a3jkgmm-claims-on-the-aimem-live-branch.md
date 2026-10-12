---
aimem: 1
id: sch-3a3jkgmm
type: schema
title: Claims on the aimem-live branch
summary: JSON claim documents stored on a separate git branch.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-07-05T09:00:00Z
updated: 2026-07-05T09:00:00Z
verified: 2026-07-05
datastore: git:aimem-live
objects: [claims/*.json]
---

## Shape
One file per task: holder, session, paths, since, heartbeat, ttl.

## Invariants
At most one live holder per task.

## Migration notes
Format may change before M3 ships.

## Gotchas
Never commit claims to feature branches.
