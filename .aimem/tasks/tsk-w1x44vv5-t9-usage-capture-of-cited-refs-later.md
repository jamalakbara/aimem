---
aimem: 1
id: tsk-w1x44vv5
type: task
title: "T9: Usage capture of cited refs (later)"
summary: Record which refs agents cite or use. No learned weights.
status: done
trust: agent
roles: [all]
paths: [packages/core/src/, packages/cli/src/commands/session.ts]
author: agent:claude-code
created: 2026-11-15T17:27:24Z
updated: 2026-11-17T22:08:27Z
priority: p3
---

## Goal
Capture explicitly cited refs per session in a local cache without learned weights or ranking changes.

## Acceptance criteria
- [x] Local cited-ref log per opaque session
- [x] Usage does not change ranking or learn weights
- [x] Separate from T6 metadata-only call diagnostics

## Notes
Merged in PR #46 after all six OS/Node checks passed. Use aimem usage record --session <opaque-id> --refs <ref,...>. Events go to the gitignored .aimem/.cache/usage.jsonl cache, never records or INDEX. Same-project refs are canonicalized and deduplicated; unknown refs and invalid sessions are rejected before writing. Tests cover concurrent writers, validation, storage failures, unchanged retrieval and cache ignore rules. No automatic ask capture or MCP usage tool is implied. See docs/04 and docs/15 section 18.
