---
aimem: 1
id: dec-acwbjc55
type: decision
title: Agent protocol is three lines, generated into instruction files
summary: Agents are told start with context, record while working, end with handoff, via a managed block in AGENTS.md and similar files.
status: accepted
trust: verified
roles: [dev]
tags: [adapters]
paths: [packages/adapters/**]
author: human:akbar
created: 2026-06-02T09:00:00Z
updated: 2026-06-02T09:00:00Z
verified: 2026-06-02
---

## Context
Long instructions get ignored or truncated by agent tools.

## Decision
Generate a short managed block per tool (AGENTS.md, CLAUDE.md, Cursor, Copilot, Gemini) and keep it idempotent.

## Consequences
Adapters must be able to remove their block cleanly.
