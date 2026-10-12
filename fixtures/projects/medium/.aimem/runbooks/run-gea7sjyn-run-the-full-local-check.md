---
aimem: 1
id: run-gea7sjyn
type: runbook
title: Run the full local check
summary: Lint, typecheck and test the whole workspace before pushing.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
owner: akbar
last_tested: 2026-10-11
---

## When to use
Before every push.

## Steps
1. pnpm install
2. pnpm lint
3. pnpm typecheck
4. pnpm test

## Rollback
Nothing to roll back.

## Verify
All three commands exit 0.
