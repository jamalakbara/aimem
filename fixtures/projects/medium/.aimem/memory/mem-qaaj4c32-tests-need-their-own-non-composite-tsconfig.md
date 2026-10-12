---
aimem: 1
id: mem-qaaj4c32
type: memory
title: Tests need their own non-composite tsconfig
summary: Including test files in a composite project fails with TS6307; tests are typechecked by a separate noEmit tsconfig.test.json.
status: active
trust: agent
roles: [dev]
tags: [tooling, testing]
paths: [tsconfig.test.json]
author: agent:claude-code
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
kind: howto
---

tsc -b complained that package sources were not in the test project's file list. The fix: keep packages as composite projects and typecheck tests with tsconfig.test.json (noEmit, paths alias to src).

pnpm typecheck runs both.
