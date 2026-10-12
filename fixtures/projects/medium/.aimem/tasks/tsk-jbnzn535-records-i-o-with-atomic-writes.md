---
aimem: 1
id: tsk-jbnzn535
type: task
title: Records I/O with atomic writes
summary: Parse and serialize records, preserve unknown keys and order, generate ids and slugs, write atomically.
status: open
trust: verified
roles: [dev]
tags: [core, format]
paths: [packages/core/src/records/**]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
links: [mem-x7h3b3km, mem-hrm4q190]
priority: p0
---

## Goal
Reading then writing any record loses nothing.

## Acceptance criteria
- [ ] Unknown keys kept in order
- [ ] Temp file plus rename
- [ ] Injected fs, clock and random

## Notes
Quote YAML scalars that would break or change type.
