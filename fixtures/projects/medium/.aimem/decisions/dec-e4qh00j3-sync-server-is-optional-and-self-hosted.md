---
aimem: 1
id: dec-e4qh00j3
type: decision
title: Sync server is optional and self-hosted
summary: Solo and small teams run on git alone; a single-team server adds realtime claims, shared index and the web app.
status: accepted
trust: verified
roles: [devops, dev]
tags: [server, sync]
paths: [packages/server/**]
author: human:akbar
created: 2026-05-15T09:00:00Z
updated: 2026-05-15T09:00:00Z
verified: 2026-05-15
---

## Context
Requiring a server would block the solo use case and adds operations work.

## Decision
The server is one container plus Postgres, self-hosted per team. Multi-tenant hosting is out of scope.

## Consequences
Every feature needs a git-only path or a documented degradation.
