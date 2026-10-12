---
aimem: 1
id: dec-9h7m0yg3
type: decision
title: New decisions start as proposed
summary: A decision created without an explicit status begins as proposed, matching the lifecycle in spec 03.
status: accepted
trust: verified
roles: [dev]
tags: [schema, cli]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
supersedes: dec-bcehh3ph
---

## Context
The spec lifecycle is proposed then accepted or rejected.

## Decision
DEFAULT_STATUS.decision = proposed; spec 03 section 4 gained a default-on-create column.

## Consequences
Agents must pass --status accepted when a human already agreed.
