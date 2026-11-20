---
aimem: 1
id: mem-qmreqqx7
type: memory
title: git ls-remote and fetch hang forever on a silent remote
summary: "Git has no default timeout: a remote that accepts the TCP connection but never answers blocks fetch/push/ls-remote indefinitely; aimem caps each aimem-live call at AIMEM_LIVE_TIMEOUT_MS (10 s)."
status: active
trust: agent
roles: [all]
tags: [m3, claims, git]
paths: [packages/core/src/git/*.ts]
author: agent:openbot-backend
created: 2026-11-20T23:06:12Z
updated: 2026-11-20T23:06:12Z
kind: gotcha
---

Found by QA on M3.5a: `aimem context` never returned against a TCP server that accepted connections but stayed silent. Plain `git ls-remote git://host:port/x` behaves the same (verified: still running when killed after 5 s).

Fix (M3.5 hardening): `GitOptions.timeoutMs` on network calls; `execaGit` kills the process and returns code 124; live.ts maps it to SYNC_FAILED. Tests use `execaGit(env, { networkTimeoutMs })` with a short limit and a silent `node:net` server.
