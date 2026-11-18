# T7–T9 implementation plan

Status: approved on 2026-11-17; T8 and T9 merged on 2026-11-18.
T7 also merged on 2026-11-18 in PR #56, meeting its numerical target.

| Task | Outcome |
|------|---------|
| T7 | Default local context gains +0.1818 (0.9545 vs lexical 0.7727), retaining keyword 1.0, multilingual 0.9091 and trap 1.0. See 15 §7 and the 68-question final report. |
| T8 | Core, CLI and MCP features are implemented; both defaults remain none. Real answer deltas include regressions; see 19. |
| T9 | Explicit per-session usage command and local cache are implemented and tested; see 04 and 15 §18. |

Requested scope: finish T7, the remaining T8 features, and T9. Each numbered
slice gets its own PR; adapter changes follow core changes. Existing uncommitted
notebook records are preserved. Feature work stays off `main`.

## Acceptance

| Task | Required result |
|------|-----------------|
| T7 | Default offline hybrid paraphrase recall@10 improves by at least +0.15 over lexical; keyword recall does not regress; report eval deltas. |
| T8 | Implement opt-in local cross-encoder reranking and LLM query rewriting; defaults remain `none`; report eval deltas and preserve the offline fallback. Existing LLM ask reranking remains supported. |
| T9 | Capture cited refs per session in a local log; usage never changes ranking without review. |

## Slices

### 1. T7: diagnose misses and improve default retrieval

- First add regression cases and a new held-out question set, before evaluating
  candidate changes. Preserve the original medium questions and expected refs.
- Reproduce real MiniLM lexical/hybrid baselines. Inspect the missed records'
  candidate admission, lexical/semantic components, query construction, trust,
  freshness and graph contributions. Earlier weight, RRF, chunk-format and fp32
  experiments did not reach the target; avoid repeating that sweep.
- Test focused changes to query construction and relevance calibration first;
  compare a different local embedding model only if the evidence calls for it.
  Keep model downloads explicit and record any cache/model migration cost.
- Accept only an offline default change reaching the target, preserving keyword
  recall, improving multilingual retrieval over lexical, with zero forbidden refs,
  deterministic output and full budget compliance. LLM reranking does not close T7.
- Likely files: `core/src/context/score.ts`, `core/src/embed/semantic.ts`,
  `core/src/embed/cache.ts`, matching core tests, eval fixtures/results and docs 06/15.
  Split a model/provider change into another slice if necessary.
- Risk: this is a measured quality target, not a guaranteed outcome. If focused
  changes fail, report the remaining misses and leave T7 open rather than lower
  the target or tune expected answers to match the implementation.

### 2. T8: query rewriting in core

- Use the existing `retrieval.query_rewrite: llm` setting and configured LLM.
  Generate two or three bounded reformulations from the query only; keep the
  original query and fuse all result lists deterministically.
- Require existing remote consent. Invalid output, timeouts, missing provider or
  disabled consent preserve the exact original retrieval result with a warning.
- Apply hard status/repo filters, secret exclusions and `no-embed` rules before
  content reaches any model. Keep trust/freshness policy and budget enforcement.
- Tests first: disabled path makes no LLM calls; output count/length limits,
  malformed/duplicate responses, provider failures, candidate filtering,
  deterministic fusion, injected clock/filesystem and metadata call logging.
- Likely files: new core retrieval rewrite module, core exports, context/ask
  orchestration, matching tests and docs 15. No new config keys are needed.

### 3. T8: local cross-encoder in core

- Implement `retrieval.rerank: cross-encoder` behind an injected ranker interface.
  Compare a bounded shortlist of multilingual local models using the unchanged
  medium set and held-out cases; document the selected model, size and latency.
- Score at most 50 eligible candidates. Load only cached models during retrieval;
  permit downloads only through an explicit indexing/setup operation.
- Preserve filters and trust/freshness policy. Missing model/runtime, invalid
  scores, or inference failure restore the original selection with a warning.
- Tests first: provider invocation bounds, score validation, tie order,
  exclusions, unavailable-model fallback and zero remote calls. Normal tests
  use a stub ranker; real evaluations are separate.
- Likely files: new core retrieval ranker/provider modules, existing context/ask
  orchestration, core exports, matching tests and docs 11/15.

### 4. T8: CLI integration

- Wire rewrite and cross-encoder providers into `context`, `search` and `ask`
  where their documented settings apply; expose an explicit ranker download
  operation and doctor diagnostics. Keep `context --deep` reserved: its expanded
  body/budget behavior is a separate feature, not a prerequisite for T8.
- Propose any new setup option in docs 04 before implementing it; record the
  ranker model/cache contract in docs 03/15 in the same PR.
- Tests first: default JSON/exit contracts, consent, offline operation, model
  download opt-in, metadata logging and exact fallback results.
- Likely files: CLI semantic/provider helpers, context/search/ask/index/doctor
  command modules, CLI tests and docs 03/04. Split setup if this exceeds ten files.

### 5. T8: MCP integration and quality verification

- Reuse core providers in MCP without duplicating ranking policy or changing
  tool schemas unnecessarily. Test no-consent, missing-model and fallback paths.
- Run real paired answer evaluations alongside retrieval evaluations. Report
  citation precision, refusals, injection resistance and latency; retrieval gains
  alone do not establish better generated answers. Defaults remain disabled.
- Likely files: MCP provider/tool wiring, MCP tests, eval runners/results and docs
  05/12/15. Update T8's acceptance checklist only for verified behavior.

### 6. T9: local cited-ref capture

- Proposed CLI contract: `aimem usage record --session <id> --refs <ref,...>`.
  Reject unknown refs and invalid/oversized session identifiers before appending.
  Deduplicate refs within an event. Explicit reporting enables external agents
  to report actual use; merely returning a briefing does not count as use.
- Proposed disposable file: `.aimem/.cache/usage.jsonl`, separate from T6 call
  diagnostics, which intentionally omit ref identifiers. Each event contains
  `version: 1`, UTC `time`, opaque `session`, `source: agent`, and `refs`.
  Store no questions, answers, record content, credentials or personal data.
- Document this new cache layout and command in docs 03/04/15 in the same PR.
  No project config or record fields are added. Logs stay local and gitignored;
  deleting them clears usage history. No learned weights or ranking changes.
- Tests first: ref/session validation, no append on invalid input, append-only
  events, concurrent writers, filesystem failure, path containment, cache ignore
  behavior, unchanged records/ranking, and command JSON/exit contracts.
- Likely files: new core usage module and exports, core tests, CLI command/run
  wiring and tests, docs 03/04/15. MCP usage reporting and automatic ask capture
  can follow separately; neither is required by T9's current acceptance criteria.

## Validation and completion

For each slice, write failing tests first, then run build, lint, typecheck and
unit/integration tests. Run retrieval evals for ranking changes and real-model
evals for any claimed quality improvement. Baseline updates must include before/
after deltas. Keep command JSON envelopes and error/exit contracts stable unless
an additive change is explicitly documented and tested. End with an aimem handoff.

T7's numerical gate must actually pass before it is marked done. T8 and T9 can
proceed as separate opt-in features if T7 research does not yet produce a passing
default; record that dependency exception rather than imply T7 is complete.
