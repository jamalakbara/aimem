---
aimem: 1
id: hnd-pv2jz9ct
type: handoff
title: "Handoff 2026-11-27: 6.1b part 1 (local branch local/m6-1b-sse on adc0741, not pushed): GET /events SSE, EventHub LISTEN…"
summary: "Done: 6.1b part 1 (local branch local/m6-1b-sse on adc0741, not pushed): GET /events SSE, EventHub LISTEN per instance with reconnect and polling, Streams with cursor rules, dedup, access re-check, 2…"
status: final
trust: agent
roles: [all]
author: agent:openbot-backend
created: 2026-11-27T18:13:13Z
updated: 2026-11-27T18:13:13Z
branch: local/m6-1b-sse
---

## Done
6.1b part 1 (local branch local/m6-1b-sse on adc0741, not pushed): GET /events SSE, EventHub LISTEN per instance with reconnect and polling, Streams with cursor rules, dedup, access re-check, 256 limit, buffer, cleanup; 21 PostgreSQL stream tests for CI, 21 local unit tests, events row in the permission matrix, 7 SSE mutations

## Not done
PostgreSQL stream tests never ran (CI only, no PR yet); sweeper (KL-4/KL-6 with sweeper), p95 harness and job, 6.1b docs; red-proof CI run for the tests-only commit

## Next
Raka QA on the local checkout; then, with owner approval, push the branch and open a 6.1b draft PR on top of #121 so the server and server-mutation jobs run

## Blocked
Pushing or opening a PR needs approval; #121 stays draft and unmerged

## Notes for next agent
none
