# 12 — Testing Strategy

The product's value depends on three things being right: the **file format is stable**, the **briefing is relevant**, and **concurrency does not corrupt or mislead**. Testing is weighted toward those.

## 1. Test layers

| Layer | Scope | Tools | Run |
|-------|-------|-------|-----|
| Unit | parser, serializer, ID/slug, schema, validation rules, scoring, packing, secret scanner | Vitest | every commit |
| Property-based | round-trip (parse→serialize→parse), unknown-key preservation, ID uniqueness, packing never exceeds budget | fast-check | every commit |
| Golden/snapshot | `INDEX.md`, briefing markdown/JSON, CLI `--json` outputs | Vitest snapshots | every commit |
| Integration | CLI end-to-end in temp git repos (init, add, handoff, supersede, validate); the M1 e2e runs the **built** binary as separate processes (Vitest global setup builds first) | Vitest + temp dirs | every commit |
| Concurrency | two/many clones racing claims against a bare remote | scripts + Vitest | every commit (fast), nightly (stress) |
| MCP | tool schemas and behaviour via SDK client; stdio and HTTP | Vitest | every commit |
| Connectors | import pipeline, templates, idempotency, source-missing handling; recorded Google API fixtures (Odoo stub server deferred) | Vitest + stubs | every commit |
| Server | API, claims transactionality, SSE, auth, indexer | Vitest + Testcontainers Postgres | every commit |
| Web | critical flows, a11y checks | Playwright + axe | PR + nightly |
| Security | secret fixtures, injection corpus, XSS payloads, path traversal | Vitest | every commit |
| Briefing evals | relevance quality on fixture projects | custom eval runner | PR + nightly |
| Retrieval evals (hybrid) | paraphrase, multilingual, unanswerable and trap cases; lexical vs semantic vs hybrid (15 §15) | eval runner; stub embedder on PR, real local model nightly | PR + nightly |
| Performance | latency/size budgets | benchmark scripts | nightly |
| Agent smoke | scripted "fake agent" follows the protocol; optional real-agent smoke (manual) | scripts | nightly / manual |

## 2. Fixtures (`fixtures/`)

| Fixture | Contents | Used for |
|---------|----------|----------|
| `projects/tiny` | 8 records of every core type | basic tests |
| `projects/medium` | ~120 records, realistic content, supersede chains, stale items | briefing evals, perf |
| `projects/multirepo` | hub + 3 repos with cross-repo refs | resolution, missing-source behaviour |
| `projects/messy` | invalid YAML, duplicate IDs, bad statuses, secrets | validate, doctor |
| `projects/adopt-me` | repo with README, ADRs, CLAUDE.md, migrations, CI, git history | adopt extractors |
| `projects/poisoned` | records containing hostile instructions and delimiter spoofing | injection tests |
| `projects/import-samples` | docx/xlsx/Google-export markdown, template Sheets with good and bad rows | connectors, import pipeline |
| `remotes/*` | scripts building bare remotes | claims, sync |

## 3. Briefing quality evals

Format (`fixtures/evals/*.yaml`):
```yaml
project: medium
cases:
  - id: webhook-retry
    task: "fix xendit webhook retries"
    paths: ["services/webhooks/handler.ts"]
    must_include: [mem-…, dec-…, hnd-…]
    must_not_include: [dec-… ]        # superseded
    max_tokens: 4000
```
Additional fields (v0.1): set-level `clock` (evaluation time) and `k`; per case `category` (`keyword | paraphrase | multilingual | trap`), optional `ref`, `role`, `include_superseded`.

Metrics: recall@k of `must_include`, precision (no `must_not_include`), budget compliance, determinism (two runs identical), stale/inferred correctly labelled.
- recall@k: share of `must_include` among the top k records by `context` score (`explain` order); "shown": share that made it into a briefing section (not just "More").
- A `must_not_include` record is a violation if it appears anywhere in the briefing, including "More".
- `pnpm eval` prints the per-case table and category summary and compares with `fixtures/evals/baseline/<set>.lexical.json`; `--update-baseline` rewrites it. The test suite fails if results differ from the committed baseline, so scoring changes must update it deliberately and report the deltas.
- PR gates (stub embedder): keyword recall@10 ≥ 0.85, 0 violations, budget 100%, deterministic, labelled, baseline equality.
- Real-model gate (`AIMEM_REAL_MODEL=1`, `packages/core/test/eval-real.test.ts`, workflow `.github/workflows/evals.yml` nightly + manual, models cached): hybrid beats lexical on paraphrase and multilingual, keyword not lower, overall ≥ 0.85, 0 violations. `pnpm compare-models` re-runs the model comparison.
Gate: recall ≥ 0.85, 0 `must_not_include`, budget 100%. Hybrid must additionally beat lexical-only on the paraphrase and multilingual subsets (target: +0.15 recall, tuned after the first run) without regressing keyword cases, and `ask` must refuse unanswerable cases.
Unit tests use a deterministic **stub embedder** (hash-based vectors) so results are reproducible without a model.  
Weights in 06 §2 are tuned against these evals; any weight change must show eval deltas in the PR.

## 4. Concurrency tests

Scenarios (git mode, bare remote, N clones as separate dirs):
1. Two clones claim the same task simultaneously → exactly one succeeds; other gets `CLAIM_CONFLICT`.
2. Claim, kill the process (no release), advance clock past TTL → claim shows expired; `--steal` works.
3. Claim, push rejected due to unrelated commit on `aimem-live` → retry logic succeeds.
4. 20 clones × 5 tasks stress: no duplicate holders, no corrupted JSON.
5. Remote unreachable → `SYNC_FAILED`; `--local` claim syncs when remote returns.
6. Two branches add different records, merge → no conflicts; `INDEX.md` regenerated after merge.
7. Two branches edit the same record → conflict surfaces, `validate --fix` restores derived fields.

Server mode: same scenarios through the API with parallel requests, plus transaction-isolation tests on the claim-acquire path, expiry sweeping, SSE resume with `since`.

## 5. Specific high-risk areas

| Area | Tests |
|------|-------|
| Unknown frontmatter keys | rewrite preserves keys and order |
| Windows paths/newlines | CRLF input parsed; output normalised to LF; path globs normalised |
| Large repos | 5k records: index build < 3 s, `context` < 5 s |
| Git edge cases | detached HEAD, no remote, shallow clone, worktrees, submodules |
| Atomic writes | kill during write leaves no partial file |
| Secret scanner | known-good/known-bad corpora; false-positive allow-list |
| Dedupe | similar titles flagged; distinct topics not flagged |
| Embeddings | model change triggers full rebuild; corrupt cache rebuilds with lexical fallback meanwhile; dimension mismatch refused; `no-embed` records never embedded; secret-flagged records excluded |

## 6. Definition of done (per feature)
- Spec/doc updated (if behaviour or format changes).
- Unit + integration tests; golden files updated deliberately.
- `--json` output contract covered.
- Error codes and exit codes covered.
- Works offline (or degrades as documented).
- No new dependency without justification in the PR.

## 7. Release gates (v1)
- All CI green on Linux and macOS.
- Briefing evals pass gates.
- Concurrency suite and nightly stress pass for 7 consecutive nights.
- Security checklist (09 §9) complete.
- Dogfood: 2 projects × 2 weeks with the author's real agents; issues triaged.
