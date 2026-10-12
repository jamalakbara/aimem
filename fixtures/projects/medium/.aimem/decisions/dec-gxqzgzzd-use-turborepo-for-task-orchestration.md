---
aimem: 1
id: dec-gxqzgzzd
type: decision
title: Use Turborepo for task orchestration
summary: Turborepo was planned for caching builds across packages but dropped for plain pnpm scripts.
status: deprecated
trust: verified
roles: [dev]
tags: [tooling]
author: human:akbar
created: 2026-06-05T09:00:00Z
updated: 2026-06-05T09:00:00Z
verified: 2026-06-05
---

## Context
Build caching looked useful for many packages.

## Decision
Use Turborepo pipelines.

## Consequences
With three packages the overhead outweighed the gain; deprecated in favour of pnpm -r and tsc -b.
