---
aimem: 1
id: hnd-6x18k102
type: handoff
title: "Handoff 2026-10-14: M2 slice 2.5 adapters"
summary: "Done: M2 slice 2.5 adapters · Next: Slice 2.6 MCP server (stdio), all tools in docs/05."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-14T08:03:00Z
updated: 2026-10-14T08:03:00Z
branch: feat/m2-adapters
---

## Done
- New package `@aimem/adapters`: `protocolBlock` (06 §3, v1 without the claim step — human decision), `inspectBlock`/`upsertBlock`/`removeBlock` (exact round trip, property-tested), targets agents/claude/cursor/copilot/gemini + custom files, `syncAdapters`/`removeAdapters`/`adapterStatus`/`defaultTargets` (CLAUDE.md importing `@AGENTS.md` is skipped; Cursor file owned whole with frontmatter; paths must stay inside the repo).
- core `setProjectValue` (edits project.yaml keeping comments). Schema: `adapters` section (03 §6; JSON Schema snapshot updated, additions only).
- CLI `aimem adapters list|sync|remove|add`; `init --adapters` (default AGENTS.md + CLAUDE.md if present without import — human decision); doctor reports per-file adapter state. Contracts adapters-list/sync/remove.
- Built-binary check on copies of this repo's AGENTS.md/CLAUDE.md: block added to AGENTS.md, CLAUDE.md (imports) untouched, `remove` byte-identical. Mutation: breaking the round-trip rule fails 7 tests.

## Not done
- Per-tool start/end hooks (OQ-12: document recipes first). Interactive intake (OQ-28).

## Next
- Slice 2.6 MCP server (stdio), all tools in docs/05.

## Blocked
- none

## Notes for next agent
- `toMatchFileSnapshot` writes the file even in a red run; delete contract files created during a failing run before the green run (happened with adapters-remove.json).
