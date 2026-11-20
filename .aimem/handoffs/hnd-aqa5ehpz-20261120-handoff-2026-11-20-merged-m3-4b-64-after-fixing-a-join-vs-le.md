---
aimem: 1
id: hnd-aqa5ehpz
type: handoff
title: "Handoff 2026-11-20: Merged M3.4b (#64) after fixing a join-vs-leave race found by CI. Implemented M3.4c on codex/m3-4c-…"
summary: "Done: Merged M3.4b (#64) after fixing a join-vs-leave race found by CI. Implemented M3.4c on codex/m3-4c-local: --local saves unsynced claims in .aimem/.cache/claims-pending when the remote is unreac…"
status: final
trust: agent
roles: [all]
author: agent:openbot-backend
created: 2026-11-20T14:17:47Z
updated: 2026-11-20T14:17:47Z
branch: codex/m3-4c-local
---

## Done
Merged M3.4b (#64) after fixing a join-vs-leave race found by CI. Implemented M3.4c on codex/m3-4c-local: --local saves unsynced claims in .aimem/.cache/claims-pending when the remote is unreachable or with --offline; reconciliation before each online claim command and live publishes them with the local started time, and drops ones that lost to a live claim, expired, or no longer resolve; live --offline lists unsynced claims. Lint, typecheck, 960 tests, the 20-clone stress test and validate --strict pass locally.

## Not done
Nothing left in M3.4. M3.5 (claims in context, status, handoff and MCP) is not planned in detail yet.

## Next
Merge the 3.4c PR after CI. Then plan M3.5 in docs/21 and get approval.

## Blocked
none

## Notes for next agent
none
