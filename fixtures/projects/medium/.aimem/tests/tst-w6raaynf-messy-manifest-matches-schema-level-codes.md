---
aimem: 1
id: tst-w6raaynf
type: testcase
title: Messy manifest matches schema-level codes
summary: V001–V005 detected exactly as messy/expected.yaml lists.
status: passing
trust: verified
roles: [qa, dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
automation: packages/schema/test/fixtures.test.ts
covers: [tsk-emxgzjyw]
---

## Preconditions
Fixtures present.

## Steps
1. pnpm test

## Expected
fixtures.test.ts messy block passes.

## Last result
Passing on 2026-10-11.
