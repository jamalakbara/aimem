---
aimem: 1
id: tst-h9arx8aw
type: testcase
title: Schema round-trip properties
summary: Random valid frontmatter parses idempotently and keeps unknown keys.
status: passing
trust: verified
roles: [qa, dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
automation: packages/schema/test/roundtrip.property.test.ts
covers: [tsk-jyz7at9r]
---

## Preconditions
pnpm install done.

## Steps
1. pnpm test

## Expected
roundtrip.property.test.ts passes.

## Last result
Passing on 2026-10-11.
