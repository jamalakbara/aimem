---
aimem: 1
id: tst-r0e4pz1p
type: testcase
title: M1 end-to-end in a fresh repo
summary: init, add decision, add memory, handoff and validate succeed in a temp git repo.
status: draft
trust: verified
roles: [qa, dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
automation: manual
covers: [tsk-aqj8yy8e]
---

## Preconditions
CLI built.

## Steps
1. git init temp
2. aimem init --solo
3. add decision and memory
4. handoff
5. validate

## Expected
All exit 0; validate clean.

## Last result
Not run yet.
