---
aimem: 1
id: hnd-asxtqxxg
type: handoff
title: "Handoff 2026-11-21: T1 met: CLI writes now refresh vectors in a detached low-priority aimem index --embeddings --backgr…"
summary: "Done: T1 met: CLI writes now refresh vectors in a detached low-priority aimem index --embeddings --background (lock + pending marker, never downloads). Measured CLI write p50 590 ms / p95 701 ms (was…"
status: final
trust: agent
roles: [all]
author: agent:openbot-backend
created: 2026-11-21T15:53:51Z
updated: 2026-11-21T15:53:51Z
branch: codex/t1-background-embed
---

## Done
T1 met: CLI writes now refresh vectors in a detached low-priority aimem index --embeddings --background (lock + pending marker, never downloads). Measured CLI write p50 590 ms / p95 701 ms (was 2732/3974), MCP write p50 416 ms / p95 508 ms after a 2.9 s first load; coverage back to 100% within seconds. Decision dec-5v4xx0xw.

## Not done
stdio.test.ts stays flaky under full parallel load (seen twice).

## Next
Owner reviews the M3.6-M3.7 stack (#73-#78) and this T1 PR.

## Blocked
Owner review.

## Notes for next agent
none
