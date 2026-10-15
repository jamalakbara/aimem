---
aimem: 1
id: sch-2tgxvmq0
type: schema
title: Fixture expected.yaml manifest
summary: Maps every fixture record file to its expected validation codes, with a fixed clock.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
datastore: files:fixtures
objects: [expected.yaml]
---

## Shape
clock, files: {path: [codes]}, optional groups for eval hints.

## Invariants
Every record file listed; codes from V001–V018.

## Migration notes
Grows when new fixtures appear.

## Gotchas
Freshness depends on the clock; always inject it.
