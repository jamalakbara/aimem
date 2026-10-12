---
aimem: 1
id: sch-ebaf2r1n
type: schema
title: project.yaml
summary: Project configuration; only aimem and project are required.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
datastore: files:.aimem/project.yaml
objects: [project.yaml]
---

## Shape
mode, sync, repos, hub, roles, members, write_policy, freshness_days, briefing, retrieval, connectors, claims, server.

## Invariants
No secrets; unknown keys warned and kept.

## Migration notes
Additive keys bump the minor version.

## Gotchas
Schema applies no defaults.
