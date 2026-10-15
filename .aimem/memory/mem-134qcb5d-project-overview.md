---
aimem: 1
id: mem-134qcb5d
type: memory
title: Project overview
summary: "aimem: a git-based shared notebook where humans and AI agents read and write project knowledge as markdown records in .aimem/."
status: active
trust: agent
roles: [all]
tags: [pinned]
author: agent:claude-code
created: 2026-10-15T02:56:05Z
updated: 2026-10-15T02:56:05Z
kind: fact
---

aimem keeps decisions, memories (gotchas, constraints), tasks, handoffs and more as markdown records with YAML frontmatter in `.aimem/`, committed with the code. Agents start a session with `aimem context` (a ranked, budgeted briefing), record findings while working, and end with `aimem handoff`.

The design lives in `docs/` (start with `docs/README.md`; `docs/03` is the record format contract). Packages: `schema`, `core`, `adapters`, `mcp`, `cli` (pnpm monorepo).

Status (2026-10-15): M0–M2 built — CLI, validator, hybrid keyword + multilingual semantic search, adapters, MCP server. Next: the one-week real-use gate, then M3 (team mode: claims on a git branch, hub, multi-repo).
