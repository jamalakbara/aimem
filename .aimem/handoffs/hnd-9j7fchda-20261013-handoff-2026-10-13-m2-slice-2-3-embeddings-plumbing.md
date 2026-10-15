---
aimem: 1
id: hnd-9j7fchda
type: handoff
title: "Handoff 2026-10-13: M2 slice 2.3 embeddings plumbing"
summary: "Done: M2 slice 2.3 embeddings plumbing · Next: Plan 2.4."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-13T08:05:00Z
updated: 2026-10-13T08:05:00Z
branch: feat/m2-embed
---

## Done
- core `embed/chunk.ts` (head chunk + `##` sections, ~300-token parts with ~40 overlap, context prefixes, `CHUNKER_VERSION`), `embed/provider.ts` (`EmbeddingProvider`, deterministic `hashEmbedder`, `resolveEmbeddingProvider` → off with reason until 2.4), `embed/cache.ts` (`buildVectorCache` incremental by chunk key, full rebuild on provider/dimension/chunker change or corruption, `no-embed`/secret exclusion, atomic writes; `loadVectorCache`; `semanticScores`).
- `Fs` port gained `readBytes` and binary `writeFile`.
- CLI: `index --embeddings`, `--rebuild` (off → warning, exit 0); `doctor` search check reports provider/cache status. `CliDeps.embedder` (tests inject the stub). Doctor contract updated deliberately (search line only).
- Tests: chunking, stub embedder, provider resolution, cache build/reuse/edit/model/dimension/corruption/rebuild, exclusions, semantic ranking, provider mismatch refused, 5k-record perf; CLI fallback (search + context still lexical), build/reuse/rebuild, doctor. Mutation: removing the secret exclusion is caught.

## Not done
- Real providers: local multilingual model (OQ-16) and `openai-compatible` (behind `allow_remote`).
- Fusing semantic scores into `context`/`search`, link expansion tuning, harder paraphrase/multilingual eval cases, eval deltas.

## Next
- Plan 2.4.

## Blocked
- none

## Notes for next agent
- `hashEmbedder` is for tests only; it measures word overlap, so it cannot show multilingual gains.
