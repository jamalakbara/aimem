---
aimem: 1
id: dec-s40ktyn4
type: decision
title: Claim path overlap warns, never blocks
summary: "Keep 07 §2.1: overlapping paths between holders add a warning and data.overlaps; tasks stay exclusive. Overlap uses static glob prefixes."
status: accepted
trust: agent
roles: [all]
tags: [m3, claims]
paths: [packages/core/src/claims/**]
author: agent:openbot-backend
created: 2026-11-20T13:18:42Z
updated: 2026-11-20T13:18:58Z
---

## Context
A team draft proposed rejecting a second exclusive claim whose paths overlap. 07 §2.1 says overlap produces a warning, never a block, because two tasks may touch the same area.

## Decision
Keep the spec. M3.4a reports overlaps with active claims by other holders as warnings and `data.overlaps`; the task claim itself remains exclusive. Overlap compares the static segments before the first wildcard segment, so false positives are possible and acceptable.

## Alternatives
Blocking on overlap would need a spec change in 07 and 04 and an exact glob-intersection algorithm.

## Consequences
People coordinate through the warning; `aimem live` shows paths for path-only claims.
