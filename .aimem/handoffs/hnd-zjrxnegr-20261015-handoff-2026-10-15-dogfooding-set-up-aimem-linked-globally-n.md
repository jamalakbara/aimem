---
aimem: 1
id: hnd-zjrxnegr
type: handoff
title: "Handoff 2026-10-15: Dogfooding set up: aimem linked globally (npm link), this repo initialised as notebook 'aimem', pro…"
summary: "Done: Dogfooding set up: aimem linked globally (npm link), this repo initialised as notebook 'aimem', protocol block in AGENTS.md, 3 pinned starter notes, vectors built (MiniLM). · Next: Human: sign…"
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-15T03:00:15Z
updated: 2026-10-15T03:00:15Z
branch: feat/m2-dogfood
---

## Done
- Dogfooding set up: aimem linked globally (npm link), this repo initialised as notebook 'aimem', protocol block in AGENTS.md, 3 pinned starter notes, vectors built (MiniLM).
- docs/HANDOFF.md migrated into 18 handoff records with original dates (all 160 lines verified).
- .mcp.json via claude mcp add; MCP Inspector 2.9.0 used as second client: tools, resources, prompts and calls all work.
- Fixed: aimem serve mcp now exits cleanly when stdin closes (found with the Inspector; test added).
- CI validates this repo's notebook; README added.

## Not done
- Claude Code headless MCP check: blocked by an expired Claude Code login; the project MCP server also needs the human's one-time approval in Claude Code.
- Human review of the 3 pinned starter notes (aimem verify).
- The one-week real-use gate (docs/13 M2).

## Next
- Human: sign in to Claude Code, approve the aimem MCP server, run a session that starts with aimem context and ends with aimem handoff.
- Human: verify or fix the 3 starter notes (aimem show / aimem verify).
- Use aimem for a real week; log annoyances as aimem notes or GitHub issues; then review findings before M3.
- Open task tsk-ewvajxqv: long handoffs outrank how-to notes in search.

## Blocked
Claude Code login expired (human must sign in).

## Notes for next agent
In zsh, store multi-word commands in a function, not a variable. MCP Inspector CLI mode prints JSON then any server warnings on the same stream.
