---
aimem: 1
id: tsk-jyz7at9r
type: task
title: Schema package with JSON Schema export
summary: Zod schemas for records and project.yaml plus generated JSON Schema files.
status: done
trust: verified
roles: [dev]
tags: [schema]
paths: [packages/schema/**]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
links: [dec-094vmt9t]
priority: p1
---

## Goal
@aimem/schema validates records and project.yaml and exports JSON Schema.

## Acceptance criteria
- [x] Round-trip property tests
- [x] JSON Schema snapshot

## Notes
Zod 4; no defaults in schemas.
