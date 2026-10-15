---
aimem: 1
id: dec-g17nvbca
type: decision
title: "Two speeds of data: live state vs durable knowledge"
summary: Who-is-doing-what changes by the minute and stays out of records; decisions and memories change slowly and are committed.
status: accepted
trust: verified
roles: [dev, devops]
tags: [sync, claims]
author: human:akbar
created: 2026-04-20T09:00:00Z
updated: 2026-04-20T09:00:00Z
verified: 2026-04-20
---

## Context
Writing claims into task files caused merge conflicts on every heartbeat in early sketches.

## Decision
Keep two layers: durable records in the repo, and a separate fast-moving layer for presence and claims.

## Consequences
Task files never hold claim holders. Briefings combine both layers at read time.
