---
aimem: 1
id: tst-cw10hn77
type: testcase
title: JSON Schema contract snapshot
summary: The exported JSON Schema matches the committed snapshot.
status: passing
trust: verified
roles: [qa, dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
automation: packages/schema/test/json-schema.test.ts
covers: [tsk-jyz7at9r]
---

## Preconditions
Schema unchanged.

## Steps
1. pnpm test

## Expected
json-schema.test.ts passes.

## Last result
Passing on 2026-10-11.
