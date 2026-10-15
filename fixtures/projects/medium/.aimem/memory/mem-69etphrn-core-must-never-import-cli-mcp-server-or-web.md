---
aimem: 1
id: mem-69etphrn
type: memory
title: core must never import cli, mcp, server or web
summary: Package dependency direction is schema ← core ← adapters/cli/mcp/server; web talks to server over HTTP only.
status: active
trust: verified
roles: [dev]
tags: [architecture]
paths: [packages/core/**]
author: human:akbar
created: 2026-09-10T09:00:00Z
updated: 2026-09-10T09:00:00Z
verified: 2026-09-10
kind: constraint
---

Breaking the direction creates cycles and drags server code into the CLI bundle. schema depends only on zod.
