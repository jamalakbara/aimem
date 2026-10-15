---
aimem: 1
id: dec-2znaykpx
type: decision
title: Roles are a relevance lens, not access control
summary: Roles on records decide what each person sees first, never what they are allowed to read.
status: accepted
trust: verified
roles: [all]
tags: [web, briefing]
author: human:akbar
created: 2026-05-25T09:00:00Z
updated: 2026-05-25T09:00:00Z
verified: 2026-05-25
---

## Context
PMs, QA and analysts need different views of the same notebook.

## Decision
Use roles only for ranking and web lenses. Access control stays at the repo or server level.

## Consequences
Anyone with repo access can read everything.
