---
aimem: 1
id: mem-tr1ayss7
type: memory
title: Repo-relative paths leaving the process must use toPosix
summary: On Windows node:path returns backslashes; run any repo-relative path that is stored or printed through toPosix from @aimem/core (spec 03 §10).
status: active
trust: agent
roles: [dev]
tags: [windows, paths, testing]
paths: [packages/**]
author: agent:claude-code
created: 2026-10-20T19:43:02Z
updated: 2026-10-20T19:43:02Z
kind: gotcha
---

Node `path` (`relative`, `join`, `resolve`) uses `\` on Windows. Before PR #23, `adapters add --file` saved `docs\AI.md` into project.yaml and `validate --fix` printed `.aimem\decisions\…`.

Rule: anything stored in records/project.yaml or printed (incl. `--json`) goes through `toPosix` (`@aimem/core`, util/path.ts); build relative targets with `posix.join`. Disk I/O keeps native paths. `@aimem/schema` cannot import core, so inline `.split("\\").join("/")` there.

Tests: build file paths with `fileURLToPath(new URL(…, import.meta.url))`, never `.pathname` (gives `/F:/…`). CI runs windows-latest since PR #23; Linux/macOS never show these bugs.
