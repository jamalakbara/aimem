---
aimem: 1
id: hnd-tdy1hb98
type: handoff
title: "Handoff 2026-10-14: M2 slice 2.4b real models + M2 gate"
summary: "Done: M2 slice 2.4b real models + M2 gate · Next: 2.5 adapters (AGENTS.md / CLAUDE.md / Cursor / Copilot / Gemini managed blocks)."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-14T08:02:00Z
updated: 2026-10-14T08:02:00Z
branch: feat/m2-models
---

## Done
- core `embed/local.ts` (3 candidates, `createLocalProvider`, lazy `@huggingface/transformers` as **optionalDependency**, injected `ModelLoader`, download only when allowed), `embed/remote.ts` (`createOpenAICompatibleProvider`: refuses without `allow_remote`, key from `AIMEM_EMBEDDINGS_KEY`, keeps input order, probes dimensions, never echoes the key), `loadEmbeddingProvider` (never throws; reasons).
- **Semantic normalisation:** first real comparison failed the gate for all models (raw cosine squeezed into 0.73–0.88); fixed by min-max normalising over the pool per 15 §6 (`util/normalise.ts`, used by context and search). Re-run: MiniLM-L12 overall 0.93 (paraphrase 0.86, multilingual 0.91, keyword 1.00). **Default model: paraphrase-multilingual-minilm** (OQ-16 resolved).
- CLI: injected `loadEmbedder` (bin: real, cache `$AIMEM_HOME/models`, download notice; tests: fake) so unit tests never touch models or network. `doctor` outbound data now says when record text leaves the machine.
- `pnpm compare-models`, `fixtures/evals/results/model-comparison.json`, opt-in gate test `eval-real.test.ts` (passes locally), workflow `evals.yml` (nightly + manual, cached models).
- Perf test now takes the best of 3 runs (parallel suite caused a false 3.2 s once; alone 0.6–0.8 s).
- Built binary smoke: Indonesian question finds the English note with the real model; no silent downloads.

## Not done
- Paraphrase gain is +0.09, under the 12 §3 target of +0.15 (M2 acceptance met). Incremental embedding after writes (15 §13) — today `index --embeddings` must be re-run; coverage shows in the header.

## Next
- 2.5 adapters (AGENTS.md / CLAUDE.md / Cursor / Copilot / Gemini managed blocks).

## Blocked
- none

## Notes for next agent
- `onnxruntime-node` install scripts are blocked by pnpm (approve-builds) but its prebuilt binaries work; keep it optional so installs never fail on exotic platforms.
