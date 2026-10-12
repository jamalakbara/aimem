---
aimem: 1
id: dec-j2t35mx0
type: decision
title: Random record ids, never counters
summary: Ids are a type prefix plus 8 random Crockford base32 characters so parallel branches never collide.
status: accepted
trust: verified
roles: [dev]
tags: [format]
paths: [packages/core/src/records/**]
author: human:akbar
created: 2026-05-06T09:00:00Z
updated: 2026-05-06T09:00:00Z
verified: 2026-05-06
---

## Context
Counters collide when two branches add records at the same time.

## Decision
Generate ids randomly from the alphabet 0-9 a-z without i, l, o, u. The id in frontmatter is authoritative; the slug may drift.

## Consequences
Ids are not sortable by time. Validation fails on duplicates.
