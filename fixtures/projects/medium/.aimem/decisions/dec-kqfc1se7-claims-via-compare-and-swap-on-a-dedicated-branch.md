---
aimem: 1
id: dec-kqfc1se7
type: decision
title: Claims via compare-and-swap on a dedicated branch
summary: Task claims are JSON on an aimem-live branch, updated with fetch, check, push and retry so two clones cannot both win.
status: accepted
trust: verified
roles: [dev]
tags: [claims, git]
paths: [packages/core/src/claims/**, packages/core/src/git/**]
author: human:akbar
created: 2026-05-22T09:00:00Z
updated: 2026-05-22T09:00:00Z
verified: 2026-05-22
links: [dec-g17nvbca]
---

## Context
Two agents picking the same task wastes a session and creates conflicting branches.

## Decision
Store live claims on a separate branch. Acquire by fetching, checking the holder, committing and pushing; a rejected push means retry.

## Consequences
Requires network to the remote. Expired claims can be stolen after the TTL.
