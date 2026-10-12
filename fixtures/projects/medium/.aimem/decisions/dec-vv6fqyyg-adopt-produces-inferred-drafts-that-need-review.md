---
aimem: 1
id: dec-vv6fqyyg
type: decision
title: Adopt produces inferred drafts that need review
summary: Scanning a running project creates records marked inferred, with evidence, and nothing is trusted until a human reviews it.
status: accepted
trust: verified
roles: [dev]
tags: [adopt]
author: human:akbar
created: 2026-06-18T09:00:00Z
updated: 2026-06-18T09:00:00Z
verified: 2026-06-18
---

## Context
Mechanical extraction from READMEs and ADRs is often wrong or out of date.

## Decision
adopt writes inferred drafts with evidence paths; review verifies or discards them. Re-runs are idempotent through evidence.

## Consequences
Briefings down-weight inferred records until reviewed.
