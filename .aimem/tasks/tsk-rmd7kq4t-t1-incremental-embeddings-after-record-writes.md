---
aimem: 1
id: tsk-rmd7kq4t
type: task
title: "T1: Incremental embeddings after record writes"
summary: New or changed records get embedded on write, not via a manual index --embeddings run.
status: done
trust: agent
roles: [all]
paths: [packages/core/src/embed/, packages/core/src/ops/write.ts, packages/cli/src/commands/write.ts]
author: agent:claude-code
created: 2026-11-15T17:27:19Z
updated: 2026-11-15T18:22:17Z
priority: p1
---

## Goal
Embed only changed chunks on every record write (local model, under 1 s per record), so semantic coverage stays current without a manual rebuild. Follows docs/15 §13.

## Acceptance criteria
- [x] Write embeds only changed chunks; cache keys unchanged for untouched chunks
- [ ] Local model: under 1 s per record write (not measured: model not downloaded on the dev machine)
- [x] doctor shows 100% coverage after writes
- [x] Tests use the stub embedder; no model download

## Notes
Branch feat/t1-incremental-embeddings. Refresh runs only when a cache built with the current provider exists; writes never cold-build or download. CLI cold model load per process is the open risk for the 1 s target.
