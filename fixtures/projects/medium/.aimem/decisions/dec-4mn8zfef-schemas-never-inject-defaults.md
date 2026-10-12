---
aimem: 1
id: dec-4mn8zfef
type: decision
title: Schemas never inject defaults
summary: Parsing a record or project.yaml adds no keys; defaults are constants applied by tools at the point of use.
status: accepted
trust: verified
roles: [dev]
tags: [schema]
paths: [packages/schema/src/**]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
links: [dec-094vmt9t]
---

## Context
A default like priority p2 would be written into files on every rewrite.

## Decision
No .default() in the Zod schemas. Export DEFAULT_STATUS, DEFAULT_PRIORITY and PROJECT_DEFAULTS instead.

## Consequences
Parse stays idempotent, which the round-trip property tests rely on.
