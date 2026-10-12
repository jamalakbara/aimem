---
aimem: 1
id: mem-rmqc83gx
type: memory
title: Run lint, typecheck and tests before every commit
summary: pnpm lint && pnpm typecheck && pnpm test is the local gate; CI runs the same on Linux and macOS with Node 22 and 24.
status: active
trust: verified
roles: [dev]
tags: [testing, ci]
paths: [.github/workflows/**]
author: human:akbar
created: 2026-10-12T00:00:00Z
updated: 2026-10-12T00:00:00Z
verified: 2026-10-12
kind: howto
---

All three must be green. Typecheck covers packages and tests. Tests include property tests, so failures may show a shrunk counterexample.
