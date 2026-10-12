---
aimem: 1
id: run-8hmkbbjd
type: runbook
title: Bootstrap a development machine
summary: Install git, Node LTS and pnpm and clone the repo.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-03-20T09:00:00Z
updated: 2026-03-20T09:00:00Z
verified: 2026-03-20
owner: akbar
---

## When to use
New laptop or new contributor.

## Steps
1. Install git and Node LTS
2. corepack enable
3. Clone and pnpm install

## Rollback
Not applicable.

## Verify
pnpm test passes.
