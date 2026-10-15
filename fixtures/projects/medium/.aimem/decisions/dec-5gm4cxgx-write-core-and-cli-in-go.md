---
aimem: 1
id: dec-5gm4cxgx
type: decision
title: Write core and CLI in Go
summary: Go was considered for a single static CLI binary but rejected in favour of one TypeScript codebase.
status: rejected
trust: verified
roles: [dev]
tags: [tooling]
author: human:akbar
created: 2026-04-25T09:00:00Z
updated: 2026-04-25T09:00:00Z
verified: 2026-04-25
---

## Context
A static binary would be easy to install, but the schema and MCP pieces would then live in two languages.

## Decision
Rejected. Revisit only if install friction becomes the top complaint.

## Consequences
No Go code. Single-file executables may come later via Bun.
