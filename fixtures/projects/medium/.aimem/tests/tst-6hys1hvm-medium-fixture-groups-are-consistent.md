---
aimem: 1
id: tst-6hys1hvm
type: testcase
title: Medium fixture groups are consistent
summary: Stale, expired, inferred and chain groups match the records.
status: ready
trust: verified
roles: [qa, dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
automation: packages/schema/test/fixtures-medium.test.ts
covers: [tsk-q02m86qx]
---

## Preconditions
medium fixture present.

## Steps
1. pnpm test

## Expected
fixtures-medium.test.ts passes.

## Last result
Written with the fixture.
