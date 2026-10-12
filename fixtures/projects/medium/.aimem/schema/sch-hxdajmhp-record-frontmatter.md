---
aimem: 1
id: sch-hxdajmhp
type: schema
title: Record frontmatter
summary: YAML frontmatter fields every record carries, plus per-type extras.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
datastore: files:.aimem
objects: [decisions, tasks, memory, handoffs]
---

## Shape
Required: aimem, id, type, title, summary, status, trust, roles, author, created, updated. Optional: tags, paths, links, supersedes, etc.

## Invariants
id unique per project; status allowed for type; unknown keys preserved.

## Migration notes
Breaking changes bump aimem major; aimem migrate upgrades files.

## Gotchas
Quote all-digit hashes and Done: summaries.
