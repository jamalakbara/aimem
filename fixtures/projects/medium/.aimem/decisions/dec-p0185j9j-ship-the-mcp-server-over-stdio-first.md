---
aimem: 1
id: dec-p0185j9j
type: decision
title: Ship the MCP server over stdio first
summary: The MCP server starts with stdio transport so local agent tools can use it without network setup.
status: accepted
trust: verified
roles: [dev]
tags: [mcp]
paths: [packages/mcp/**]
author: human:akbar
created: 2026-07-20T09:00:00Z
updated: 2026-07-20T09:00:00Z
verified: 2026-07-20
---

## Context
Most agent tools launch MCP servers as local processes.

## Decision
stdio in M2; HTTP transport arrives with the sync server.

## Consequences
Remote agents need the CLI until HTTP lands.
