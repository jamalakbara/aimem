---
aimem: 1
id: dec-112wfn49
type: decision
title: Allow Git claim takeover only after expiry and clock-skew grace
summary: All callers wait five minutes past nominal expiry before taking over a Git claim. Record the previous holder in the takeover commit.
status: accepted
trust: agent
roles: [all]
author: agent:codex
created: 2026-11-19T19:23:26Z
updated: 2026-11-19T19:23:26Z
---

## Context
The CLI and sync docs differed on whether a human could take over an active Git claim. Git commit dates are supplied by clients.

## Decision
Show claims as expired at heartbeat plus TTL. Allow any caller to use --steal after a five-minute skew allowance. Record the previous holder in live-branch history.

## Consequences
Heartbeat cannot revive an expired claim. The owning session can still release it. The takeover history is available until branch compaction.

## Alternatives
A human-only active override would need separate authorization. The caller-supplied author label cannot provide it.
