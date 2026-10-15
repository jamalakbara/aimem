---
aimem: 1
id: mem-g48me62t
type: memory
title: How to build, test and evaluate
summary: pnpm install, pnpm build, then pnpm lint && pnpm typecheck && pnpm test; pnpm eval for retrieval quality; the aimem CLI is linked globally with npm link.
status: active
trust: agent
roles: [dev]
tags: [pinned]
paths: [package.json, scripts/**]
author: agent:claude-code
created: 2026-10-15T02:56:05Z
updated: 2026-10-15T02:56:05Z
kind: howto
---

- Setup: `pnpm install` (Node >= 22). Build: `pnpm build` (also writes the JSON Schema files).
- Gate before every commit: `pnpm lint && pnpm typecheck && pnpm test`. Tests build the workspace first (vitest global setup) and include an end-to-end run of the built binary.
- Retrieval quality: `pnpm eval` (34-case medium set vs the committed baseline). Real model: `AIMEM_REAL_MODEL=1 pnpm vitest run packages/core/test/eval-real.test.ts`; `pnpm compare-models` re-runs the model comparison.
- CLI on this machine: `npm link` from `packages/cli` (undo: `npm unlink -g aimem`). Rebuild after source changes.
- Semantic search here: `aimem index --embeddings` (model cached in `~/.cache/aimem/models`).
