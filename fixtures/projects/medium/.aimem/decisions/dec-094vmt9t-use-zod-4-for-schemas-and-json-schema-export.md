---
aimem: 1
id: dec-094vmt9t
type: decision
title: Use Zod 4 for schemas and JSON Schema export
summary: The schema package uses Zod 4 looseObject for forward compatibility and its built-in toJSONSchema for the published schema.
status: accepted
trust: verified
roles: [dev]
tags: [schema]
paths: [packages/schema/**]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
supersedes: dec-0b20v421
---

## Context
Zod 4 ships JSON Schema export natively, removing a dependency.

## Decision
Upgrade to zod ^4. Records and project.yaml are loose objects at every level.

## Consequences
Schema snapshot test guards the exported JSON Schema contract.
