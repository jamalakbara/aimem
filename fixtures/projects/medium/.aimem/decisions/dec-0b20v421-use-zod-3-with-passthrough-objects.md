---
aimem: 1
id: dec-0b20v421
type: decision
title: Use Zod 3 with passthrough objects
summary: The first schema draft used Zod 3 and .passthrough() to keep unknown frontmatter keys.
status: superseded
trust: verified
roles: [dev]
tags: [schema]
author: human:akbar
created: 2026-10-03T09:00:00Z
updated: 2026-10-03T09:00:00Z
verified: 2026-10-03
superseded_by: dec-094vmt9t
---

## Context
Zod was chosen for one source of types, validation and JSON Schema.

## Decision
Zod 3, plus a separate converter for JSON Schema.

## Consequences
Needed an extra dependency for JSON Schema. Replaced by Zod 4.
