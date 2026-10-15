---
aimem: 1
id: dec-4955xj6e
type: decision
title: TypeScript monorepo for every package
summary: Core, CLI, MCP, server and web share one TypeScript codebase in a pnpm workspace.
status: accepted
trust: verified
roles: [dev]
tags: [tooling]
author: human:akbar
created: 2026-04-25T09:00:00Z
updated: 2026-04-25T09:00:00Z
verified: 2026-04-25
links: [dec-5gm4cxgx]
---

## Context
The MCP SDK, the web app and schema sharing all favour one language.

## Decision
Use TypeScript in strict mode across packages, with pnpm workspaces and plain pnpm scripts.

## Consequences
Node is required at runtime. A single static binary is postponed.
