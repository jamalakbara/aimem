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

Vitest caps file workers at four to bound concurrent fixture I/O. A Windows CI
run of the expanded suite previously exceeded the existing 10-second hybrid
fixture setup timeout; the worker cap preserves assertions and timeout budgets.

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
- Real-model gate (`AIMEM_REAL_MODEL=1`, `packages/core/test/eval-real.test.ts`, workflow `.github/workflows/evals.yml` nightly + manual, models cached): hybrid paraphrase gain ≥ 0.15 over lexical, multilingual beats lexical, keyword not lower, overall ≥ 0.85, 0 violations. `pnpm compare-models` re-runs the model comparison.
Gate: recall ≥ 0.85, 0 `must_not_include`, budget 100%. Hybrid must additionally beat lexical-only on the paraphrase and multilingual subsets (target: +0.15 recall, tuned after the first run) without regressing keyword cases, and `ask` must refuse unanswerable cases.
Unit tests use a deterministic **stub embedder** (hash-based vectors) so results are reproducible without a model.  
Weights in 06 §2 are tuned against these evals; any weight change must show eval deltas in the PR.

T7's default local vocabulary matching is covered by
`core/test/semantic-bridge.test.ts`: deduplication, bounds, incremental reuse,
single-input quantized word embeddings, confidence/ambiguity guards, attested
word forms, privacy/status exclusions (including stale cache sources), complete
score fusion, trust/freshness and legacy/nonlocal fallback. Three new behavior
tests failed before implementation. The real-model assertion now retains T7's
numerical gate rather than merely checking a positive gain.

After building, `node scripts/eval-t7-final.mjs` requires cached MiniLM weights
and compares lexical, prior hybrid and production hybrid across 68 fixed
questions. Its `prior:` provider facade disables only the vocabulary bridge,
while retaining exactly the same document vectors and model inference. The
original lexical fixture baseline is unchanged. Twelve calibration questions
were committed before investigation; a separate final twelve were committed
after choosing the method and before their first evaluation, and were not tuned
after that run. Results and limitations are in 15 §7 and
`fixtures/evals/results/t7-final.json`.

### 3.1 Answer evals for `aimem ask` (T5)

Cases: `fixtures/evals/ask-medium.yaml`, written before any run. Each case has a `category` (`answerable | multilingual | unanswerable | trap | injection`), a `question`, and optionally `supports` (refs a correct answer may cite), `must_not_cite` (trap records) and `must_not_contain` (injection markers). The injection record `mem-pq7r2x9k` lives in `fixtures/evals/ask-medium.overlay/` (set key `overlay`), which only the ask evals add to `medium`, so the fixture's golden files stay unchanged.

| Tier | Runs | Model | What it checks |
|------|------|-------|----------------|
| PR (`core/test/eval-ask.test.ts`, `pnpm eval:ask --fake`) | every PR | fake | retrieval recall of `supports` per case equals `fixtures/evals/baseline/ask-medium.lexical.json` (update deliberately with `--update-baseline`, report deltas); superseded trap records never reach the model for present-tense questions; the injection text stays inside its wrapper; scorer unit tests |
| Real (`pnpm eval:ask`, nightly `ask-evals` job) | nightly + on demand | `claude -p` (`AIMEM_EVAL_MODEL`, default sonnet) | answer metrics below; results in `fixtures/evals/results/ask-medium.<provider>.json` |

Metrics (real tier):
- **Citation precision**: cited refs that are in the case's `supports`, divided by all cited refs, summed over cases that have `supports`. It's deterministic, with no judge model. It is stricter than "the cited record supports the claim" (15 §15): a relevant record outside the list counts as a miss.
- **Refusal rate**: share of unanswerable cases answered "not found in the notebook".
- **Trap-win rate**: share of trap cases that cite a `must_not_cite` record and no supporting one. Lower is better.
- **Injection resistance**: share of injection cases whose answer contains none of the `must_not_contain` strings.

Real tier is **report only** for now; gates are set after a few nightly runs. The nightly job needs the `ANTHROPIC_API_KEY` repository secret (Claude Code 2.1.304 is installed in CI) and skips with a notice without it.

First run (2026-11-16, local, `claude-cli:sonnet`, lexical retrieval, 22 cases, 129 s): citation precision 0.625, refusal rate 1.0, trap-win rate 0, injection resistance 1.0, 0 errors. Retrieval misses: `ans-private-notes` (the answering decision is `rejected`, which `ask` hides for non-historical questions) and `trap-linter` (`inc-242wrkm4` did not rank into the top 8).

### 3.2 Reranking research

The optional reranking research runner is `node scripts/eval-rerank.mjs --real`
after `pnpm build` (15 §9.1). It evaluates the original medium questions and eight
questions committed before its first run, through the existing Claude Code login.
It is not part of CI and does not require configuring an Anthropic API key. Unit
tests in `core/test/eval-rerank.test.ts` validate strict candidate-only ranking
responses; the committed result file records recall, candidate ceilings, latency,
fallbacks and provider usage. This is evidence for a future opt-in implementation,
not a production acceptance gate.

For production `ask` ranking, run `node scripts/eval-ask-rerank.mjs --real` after
building. It compares the actual `askQuestion` lexical/hybrid selections against
opt-in reranking on the same 42 questions at limit 10, using the raw question (no
context path/ref expansion), a cached local embedder and Claude Code login. The
final answer is stubbed: this measures retrieval, not answer quality. Results,
warnings, usage and latency go to `results/rerank-ask-claude-cli.json`.

`node scripts/eval-ask.mjs --rerank` separately exercises real ranking **and** real
answer generation for the 22 answer cases, using lexical candidate retrieval and
the default limit 8; it writes a distinct `.rerank.json` result. Both rerank runners
remove `ANTHROPIC_API_KEY` and use the existing Claude Code login. They are optional
and outside CI. Unit/integration tests cover prompt bounds, privacy exclusions,
delimiter injection, invalid output, provider failure, consent, fallback order,
candidate depth, unchanged default JSON and two metadata log entries per successful
reranked answer. Default deterministic eval baselines must remain unchanged.

Production results and their limits are recorded in 15 §9.2: the 42-case retrieval
run reached recall@10 1.0 with two safe fallbacks, while the 22-case answer run had
lower support-list citation precision than the earlier baseline. Ranking gains
alone are not an answer-quality gate.

T8's local ranker comparison and generated-answer validation status are recorded
in [19 — T8 quality report](19-t8-quality-report.md). The optional runner
`node scripts/eval-retrieval-options.mjs --real` performs a provider preflight,
uses the unchanged 22 answer cases, and rejects quality comparisons on provider
errors. It needs a Claude Code login and a cached optional BGE ranker.

### 3.3 Search dogfood regressions

`core/test/search-handoffs.test.ts` uses sanitized build/test notes in
`fixtures/evals/search-dogfood.yaml`: direct English/Indonesian answers, explicit
history intent, and handoff-only filtering. PR semantic inputs are deterministic
test doubles. After building, `node scripts/eval-search-handoffs.mjs` compares
cached MiniLM results on medium plus those notes; `--notebook` evaluates the
current notebook, excluding the bug report that repeats the exact questions.
The runner reconstructs pre-prior order by removing the final handoff multiplier.
It never downloads a model. Notebook reports capture the corpus at run time.

`--answers` explicitly uses the Claude Code login to generate answers from the
unchanged 22 synthetic medium cases, compares against the recorded T8 baseline,
and rejects provider errors. It sends synthetic fixture records, not notebook
records. Results and limitations are in 15 §7. The handoff fix deliberately changes
ten framed selections in `ask-medium.lexical.json`; support recall is unchanged
and the default context baseline remains unchanged.

## 4. Concurrency tests

Scenarios (git mode, bare remote, N clones as separate dirs):
1. Two clones claim the same task simultaneously → exactly one succeeds; other gets `CLAIM_CONFLICT`.
2. Claim, kill the process (no release), advance clock past TTL → claim shows expired; `--steal` works.
3. Claim, push rejected due to unrelated commit on `aimem-live` → retry logic succeeds.
4. 20 clones × 5 tasks stress: no duplicate holders, no corrupted JSON.
5. Remote unreachable → `SYNC_FAILED`; `--local` claim syncs when remote returns.
6. Two branches add different records, merge → no conflicts; `INDEX.md` regenerated after merge.
7. Two branches edit the same record → conflict surfaces, `validate --fix` restores derived fields.

Fast Git claim races run in the regular CI matrix. The dedicated Git claim stress workflow runs on relevant PRs, nightly, and on demand. To run the same 20-clone test locally, set `AIMEM_CLAIM_STRESS=1` and run `pnpm exec vitest run packages/core/test/claim-acquire.test.ts -t "20 clones"`.

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

## Hosted CI runner capacity

CI keeps Ubuntu, macOS and Windows on Node 22 and 24, with identical lint,
typecheck, full-test and strict notebook-validation steps. macOS is pinned to
`macos-15-intel`: on 2026-11-18 local time, GitHub cancelled queued Arm jobs with
"The job was not acquired by Runner of type hosted even after multiple attempts"
and a macOS arm64 capacity notice. Intel is a supported standard runner
([GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).
This changes macOS architecture coverage from Arm to Intel; it does not skip
checks. Revisit Arm coverage when hosted capacity is reliable.

The Intel job also exposed an existing test assumption: optional local inference
may be unavailable at runtime import, before a model-cache lookup. Injected tests
cover both unavailable-runtime and missing-model fallback, and the real offline
loader smoke check accepts only those two actionable errors. No download or
provider-success requirement is removed.
