---
aimem: 1
id: sch-nygqk0ka
type: schema
title: Local vector cache
summary: Float32 embedding cache stored outside git under .aimem/.cache.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-09-06T09:00:00Z
updated: 2026-09-06T09:00:00Z
verified: 2026-09-06
links: [dec-mtbcq7yr]
datastore: files:.aimem/.cache
objects: [vectors]
---

## Shape
Chunks with record id, chunk index, model id and vector.

## Invariants
Model change triggers a full rebuild; dimension mismatch refused.

## Migration notes
Cache can always be deleted and rebuilt.

## Gotchas
no-embed records and secret-flagged records are never embedded.
