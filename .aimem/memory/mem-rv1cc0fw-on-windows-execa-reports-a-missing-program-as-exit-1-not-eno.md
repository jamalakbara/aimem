---
aimem: 1
id: mem-rv1cc0fw
type: memory
title: On Windows, execa reports a missing program as exit 1, not ENOENT
summary: "execa/cross-spawn runs unknown commands through cmd.exe on Windows: exit 1 with 'is not recognized as an internal or external command'; multi-line args also break .cmd shims."
status: active
trust: agent
roles: [all]
tags: [windows, process, gotcha]
paths: [packages/core/src/process/**, packages/core/src/git/**]
author: agent:claude-code
created: 2026-11-15T17:54:48Z
updated: 2026-11-15T17:54:48Z
---

## Notes
- Checked 2026-11-16 (Node, execa via cross-spawn): `execa("no-such-binary")` gives `exitCode: 1`, no `code: "ENOENT"`, and stderr `'no-such-binary' is not recognized as an internal or external command`. `core/process/run.ts` maps that stderr to code 127. `core/git/git.ts` does not yet.
- Programs installed by npm (such as `claude`) are `.cmd` shims, which run through cmd.exe. A multi-line argument does not survive that, so pass long text as a file (`--system-prompt-file`) or on stdin. Empty-string arguments (`--tools ""`) do pass through.
