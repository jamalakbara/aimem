---
aimem: 1
id: hnd-23d56g3x
type: handoff
title: "Handoff 2026-10-14: M2 slice 2.6 MCP server"
summary: "Done: M2 slice 2.6 MCP server · Next: Slice 2.7: dogfood — `aimem init` in this repo, migrate docs/HANDOFF.md into handoff records, use it for a real week (M2 gate)."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-14T08:04:00Z
updated: 2026-10-14T08:04:00Z
branch: feat/m2-mcp
---

## Done
- New package `@aimem/mcp` (`@modelcontextprotocol/sdk` 1.32.1, zod 4): `createAimemServer` with 10 tools (context, search, get, add, update, supersede, task_create, task_status, handoff, validate), 4 resources (index, record/{ref}, handoffs/latest, tasks/open), 2 prompts (start/end session); `serveStdio`.
- Author `agent:<client name>` unless AIMEM_AUTHOR; writes go through `applyWritePolicy`; stable error codes in structuredContent; `<aimem-record>` framing with tag escaping; output cap with "truncated; use aimem_get"; in-memory `client_request_id`.
- CLI `aimem serve mcp`; bin wires the server with the same embedder loader (never downloads).
- Tests: contract file per tool (in-memory SDK client) + error path each; framing escape (mutation-checked); author; cap; resources; prompts; stdio e2e with the SDK client launching the built binary in a temp git repo (agent writes committed, tree clean).
- Claim tools left out until M3 (human decision). Docs 05 v0.1 notes, 04 serve.

## Not done
- Trying it in two real clients (docs/05 §6) — do it during 2.7 dogfooding (Claude Code `.mcp.json`, plus one more). Generating per-tool MCP config files.

## Next
- Slice 2.7: dogfood — `aimem init` in this repo, migrate docs/HANDOFF.md into handoff records, use it for a real week (M2 gate).

## Blocked
- none

## Notes for next agent
- In serve mode stdout is the protocol channel; never write logs to stdout from code reachable by the MCP server.
