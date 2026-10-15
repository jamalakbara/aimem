---
aimem: 1
id: hnd-ehn38y11
type: handoff
title: "Handoff 2026-10-12: M1 slice 1.3 index, INDEX.md, BM25 search"
summary: "Done: M1 slice 1.3 index, INDEX.md, BM25 search · Next: Slice 1.4 CLI: `init --solo`, `add`, `show`, `list`, `update`, `supersede`, `verify` with `--json` contracts and exit codes; `validate --fix`."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-12T08:07:00Z
updated: 2026-10-12T08:07:00Z
branch: feat/m1-index
---

## Done
- `@aimem/core`: `buildIndex` (pure, order-independent) / `loadIndex` / `readNotebookFiles` (validator now reuses it); own BM25 `tokenize` + `bm25` (title 3, summary 2, tags 1.5, body 1; no stemming; accent folding); `search` with type/status/tag/role/repo/path filters, `HIDDEN_STATUSES` per 06 §2, ties by id, scores 0..1; `matchGlob`/`globToRegExp`/`staticPrefix`; `renderIndexMd` (03 §8, ≤ 6 KB with "… and N more", no timestamps) + `writeIndexMd` (atomic, only on change).
- Golden files `packages/core/test/__snapshots__/{tiny,medium}.INDEX.md`. Perf: 5k records index + search + render ≈ 0.5 s (budget 3 s).
- Docs: 03 §8 truncation/no timestamps, 04 search default filter, 11 lexical search row.

## Not done
- Index cache on disk (not needed at current speed).
- `.gitattributes merge=ours` for INDEX.md and regeneration hook (M3).

## Next
- Slice 1.4 CLI: `init --solo`, `add`, `show`, `list`, `update`, `supersede`, `verify` with `--json` contracts and exit codes; `validate --fix`.

## Blocked
- none

## Notes for next agent
- Search builds BM25 over the *filtered* candidates, so IDF depends on filters; fine for ranking, don't compare raw scores across different filter sets.
- Golden INDEX.md files change whenever fixture records change; update them deliberately (`vitest -u`).
