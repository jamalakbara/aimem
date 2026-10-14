# Handoff log

Append-only session log until M1 ships `aimem handoff` (docs/17 §1 rule 5). Newest first.

## 2026-10-14 — M2 slice 2.5 adapters (branch `feat/m2-adapters`, stacked on `feat/m2-models`)

### Done
- New package `@aimem/adapters`: `protocolBlock` (06 §3, v1 without the claim step — human decision), `inspectBlock`/`upsertBlock`/`removeBlock` (exact round trip, property-tested), targets agents/claude/cursor/copilot/gemini + custom files, `syncAdapters`/`removeAdapters`/`adapterStatus`/`defaultTargets` (CLAUDE.md importing `@AGENTS.md` is skipped; Cursor file owned whole with frontmatter; paths must stay inside the repo).
- core `setProjectValue` (edits project.yaml keeping comments). Schema: `adapters` section (03 §6; JSON Schema snapshot updated, additions only).
- CLI `aimem adapters list|sync|remove|add`; `init --adapters` (default AGENTS.md + CLAUDE.md if present without import — human decision); doctor reports per-file adapter state. Contracts adapters-list/sync/remove.
- Built-binary check on copies of this repo's AGENTS.md/CLAUDE.md: block added to AGENTS.md, CLAUDE.md (imports) untouched, `remove` byte-identical. Mutation: breaking the round-trip rule fails 7 tests.

### Not done
- Per-tool start/end hooks (OQ-12: document recipes first). Interactive intake (OQ-28).

### Next
- Slice 2.6 MCP server (stdio), all tools in docs/05.

### Blocked
- none

### Notes for next agent
- `toMatchFileSnapshot` writes the file even in a red run; delete contract files created during a failing run before the green run (happened with adapters-remove.json).

## 2026-10-14 — M2 slice 2.4b real models + M2 gate (branch `feat/m2-models`, stacked on `feat/m2-hybrid`)

### Done
- core `embed/local.ts` (3 candidates, `createLocalProvider`, lazy `@huggingface/transformers` as **optionalDependency**, injected `ModelLoader`, download only when allowed), `embed/remote.ts` (`createOpenAICompatibleProvider`: refuses without `allow_remote`, key from `AIMEM_EMBEDDINGS_KEY`, keeps input order, probes dimensions, never echoes the key), `loadEmbeddingProvider` (never throws; reasons).
- **Semantic normalisation:** first real comparison failed the gate for all models (raw cosine squeezed into 0.73–0.88); fixed by min-max normalising over the pool per 15 §6 (`util/normalise.ts`, used by context and search). Re-run: MiniLM-L12 overall 0.93 (paraphrase 0.86, multilingual 0.91, keyword 1.00). **Default model: paraphrase-multilingual-minilm** (OQ-16 resolved).
- CLI: injected `loadEmbedder` (bin: real, cache `$AIMEM_HOME/models`, download notice; tests: fake) so unit tests never touch models or network. `doctor` outbound data now says when record text leaves the machine.
- `pnpm compare-models`, `fixtures/evals/results/model-comparison.json`, opt-in gate test `eval-real.test.ts` (passes locally), workflow `evals.yml` (nightly + manual, cached models).
- Perf test now takes the best of 3 runs (parallel suite caused a false 3.2 s once; alone 0.6–0.8 s).
- Built binary smoke: Indonesian question finds the English note with the real model; no silent downloads.

### Not done
- Paraphrase gain is +0.09, under the 12 §3 target of +0.15 (M2 acceptance met). Incremental embedding after writes (15 §13) — today `index --embeddings` must be re-run; coverage shows in the header.

### Next
- 2.5 adapters (AGENTS.md / CLAUDE.md / Cursor / Copilot / Gemini managed blocks).

### Blocked
- none

### Notes for next agent
- `onnxruntime-node` install scripts are blocked by pnpm (approve-builds) but its prebuilt binaries work; keep it optional so installs never fail on exotic platforms.

## 2026-10-14 — M2 slice 2.4a hybrid scoring (branch `feat/m2-hybrid`, stacked on `feat/m2-embed`)

### Done
- 10 hard eval cases (no shared content words) committed **before** any run; eval set now 34 cases.
- core: `SemanticInput` into `context` scoring (0.25 lexical + 0.25 semantic, semantic top-50 candidates, hard filters first), `rrf` fusion option, header `on (model, coverage)` / `off (reason)`, chain-head link expansion (15 §8 rule 1), exported `buildQuery`; `semanticForQuery` (scores + coverage or reason; cache meta now lists excluded refs); hybrid `search(…, semantic)`; `runEvalSet` async with optional semantic provider.
- CLI: `--mode` defaults to `retrieval.mode` (else hybrid) for `context` and `search`; falls back to lexical with a reason; warns only when hybrid was explicit. Contracts/golden updated deliberately (header line, reason fields, `semantic: 0` parts — no ranking changes).
- Lexical-only results proven unchanged: the original 24 eval cases are identical to the previous baseline. New lexical baseline (34 cases): keyword 1.00 · trap 1.00 · paraphrase 0.77 · multilingual 0.64 · overall 0.809.
- Mutation: removing chain-head expansion is caught.

### Not done (2.4b)
- Real local model + model comparison (OQ-16), `openai-compatible` provider, real-model eval vs lexical (M2 gate), CI job for real-model evals.

### Next
- Plan/build 2.4b.

### Blocked
- none

### Notes for next agent
- The stub embedder measures word overlap, so stub-hybrid eval numbers mean nothing for quality; only the smoke properties (budget, determinism, violations) are asserted.

## 2026-10-13 — M2 slice 2.3 embeddings plumbing (branch `feat/m2-embed`, stacked on `feat/m2-evals`)

### Done
- core `embed/chunk.ts` (head chunk + `##` sections, ~300-token parts with ~40 overlap, context prefixes, `CHUNKER_VERSION`), `embed/provider.ts` (`EmbeddingProvider`, deterministic `hashEmbedder`, `resolveEmbeddingProvider` → off with reason until 2.4), `embed/cache.ts` (`buildVectorCache` incremental by chunk key, full rebuild on provider/dimension/chunker change or corruption, `no-embed`/secret exclusion, atomic writes; `loadVectorCache`; `semanticScores`).
- `Fs` port gained `readBytes` and binary `writeFile`.
- CLI: `index --embeddings`, `--rebuild` (off → warning, exit 0); `doctor` search check reports provider/cache status. `CliDeps.embedder` (tests inject the stub). Doctor contract updated deliberately (search line only).
- Tests: chunking, stub embedder, provider resolution, cache build/reuse/edit/model/dimension/corruption/rebuild, exclusions, semantic ranking, provider mismatch refused, 5k-record perf; CLI fallback (search + context still lexical), build/reuse/rebuild, doctor. Mutation: removing the secret exclusion is caught.

### Not done (slice 2.4)
- Real providers: local multilingual model (OQ-16) and `openai-compatible` (behind `allow_remote`).
- Fusing semantic scores into `context`/`search`, link expansion tuning, harder paraphrase/multilingual eval cases, eval deltas.

### Next
- Plan 2.4.

### Blocked
- none

### Notes for next agent
- `hashEmbedder` is for tests only; it measures word overlap, so it cannot show multilingual gains.

## 2026-10-13 — M2 slice 2.2 eval harness (branch `feat/m2-evals`, stacked on `feat/m2-context`)

### Done
- `fixtures/evals/medium.yaml`: 24 cases (8 keyword, 6 paraphrase, 6 multilingual, 4 trap), committed **before** the first run.
- core `eval/run.ts` `runEvalSet`: recall@k, shown-in-briefing, violations, budget, determinism, unlabelled inferred/stale; per-category and overall summaries.
- `pnpm eval` (`scripts/eval.mjs`): table + deltas vs `fixtures/evals/baseline/medium.lexical.json`; `--update-baseline`.
- Gates in tests: keyword recall@10 ≥ 0.85, 0 violations, budget 100%, deterministic, labelled; results must equal the baseline (mutation: changing weights fails both).
- **Lexical baseline:** keyword 1.00 · trap 1.00 · paraphrase 0.75 · multilingual 0.67 · overall 0.854; 0 violations.

### Not done
- Hard cases: several paraphrase/multilingual cases share words with their records (e.g. "index"/"edit" are the same in Indonesian notes), so they are easier than intended. Add harder cases (no shared tokens) before 2.4 so hybrid's gain is measured honestly.

### Next
- Slice 2.3: chunking + embeddings behind an interface, deterministic stub embedder for tests, lexical fallback, vector cache.

### Blocked
- none

### Notes for next agent
- Misses: para-lint-silent (mem-rj2t0xj9), para-who-is-working (mem-peqcrkme), ml-id-agent-commit (dec-ek66gxgx), ml-id-delete (dec-b0gymeq0).

## 2026-10-13 — M2 slice 2.1 `context` v0 (branch `feat/m2-context`, stacked on `feat/m1-session`)

### Done
- core `context/score.ts` (`scoreCandidates`: filter, query from task + branch words + ref task + path tags, lexical/paths/links/recency/type/role × trust × freshness, pins) and `context/briefing.ts` (`buildBriefing`: warnings, section packing with scaled caps and carry, hard budget guard, md render with safety notice and trust/source labels, heading demotion, explain rows; `estimateTokens` = chars/4). `gitChangedFiles`.
- CLI `context` with all 04 flags; no-arg inference from git changes + branch; `--explain` table; `--format json`; warnings for `--mode hybrid` / `--deep`.
- Tests: scoring components, pins, filters, warnings, determinism, budget property test (150 random budgets/queries), golden briefing `packages/cli/test/__snapshots__/briefing-medium-zod.md`, contract `context.json`. Mutation: loosening caps without the guard is caught.
- Fix during review of the golden output: full bodies now go to top-scoring records, not to pins.
- Docs: 04 context, 06 §2.2a implementation notes, 14 OQ-30. `wip/` deleted (all drafts rebuilt).

### Not done
- Retrieval quality is unmeasured until the eval harness (2.2). Link rescue of hidden records ("unless linked from a selected record") not implemented.

### Next
- Slice 2.2: eval harness (12 §3) + `medium` eval set (keyword, paraphrase, multilingual, trap cases) using `medium/expected.yaml` groups.

### Blocked
- none

### Notes for next agent
- Golden briefing changes whenever scoring or fixture content changes; review the diff, then `vitest -u`.

## 2026-10-13 — M1 slice 1.5 handoff, status, doctor, M1 e2e (branch `feat/m1-session`, stacked on `feat/m1-git`)

### Done
- core: `addHandoff` + `parseHandoffFile` (03 §3.4; derived title/summary with spec limits; task must be a task; no dedupe), `summarizeNotebook`, `gitDiagnostics` (version, repo, user, remotes, branch; no network), `applyWritePolicy({override})` for `handoff --commit`.
- CLI: `handoff` (flags or `--from-file`, branch from git, `--commit`, `--release-claims` no-op + warning), `status`, `doctor` (9 checks, always exit 0). Contracts: handoff/status/doctor.
- **M1 e2e** (`packages/cli/test/e2e.test.ts`): built binary as separate processes in a fresh git repo — init → decide → remember (stdin) → handoff → validate --strict, status, doctor; one commit per agent write containing only `.aimem/` files; clean tree; exit codes 1/2/3 from the real process. `vitest.global-setup.ts` builds first (mutation-checked: a source change is caught).
- Docs 04 (handoff/status/doctor), 12 (e2e on built binary).

### Not done
- Removing `wip/` (all drafts rebuilt) — propose with the M1 close.
- Session tracking ("sessions without handoff") needs session ids (OQ-11, M3).

### Next
- Close M1 with evidence (docs/17 prompt); then M2 slice 2.1 `context` v0.

### Blocked
- none

### Notes for next agent
- Tests now build the monorepo once per run (global setup); a broken build fails the whole test run early.

## 2026-10-13 — M1 slice 1.4c git + validate --fix (branch `feat/m1-git`, stacked on `feat/m1-cli-write`)

### Done
- `core/git` (`execa`): `Git` interface (never throws; 127 when git can't start), `execaGit`, `isGitRepo`, `gitUserName`. Only module that spawns processes.
- `ops/policy.ts`: `effectivePolicy` (solo → commit, else stage), `applyWritePolicy` (agents only; `git add` + `git commit --only -- <files>`; pr → stage + warning; not a repo / no git / hook failure → warning, records kept), `resolveAuthorWithGit` (flag → env → `user.name` slugified).
- `validate/fix.ts` `fixNotebook`: V015 rename (skip if target exists), V007 missing half (+ status superseded where allowed), `updated` < `created`; refreshes INDEX.md.
- CLI: `CliDeps.git`; write commands report `data.git` and git warnings; `supersede --author`; `validate --fix` with `data.fixed/skipped`. Contracts add/update/verify gained `git` (deliberate).
- Tests: real temp git repos isolated via `GIT_CONFIG_GLOBAL=/dev/null` (commit only touched files, staged work untouched, team stage, pr, none/human, first commit, no repo, no git, failing hook, author from git); fix on tiny/messy copies; CLI with a fake git. Real-repo smoke test by hand.
- OQ-4 resolved; 04 §1/§4/validate updated.

### Not done
- `link`, `discard`, `move`, `review`; PR policy; live branch (M3).

### Next
- Slice 1.5: `handoff`, `status`, `doctor`, and the scripted M1 e2e (init → add decision → add memory → handoff → validate) running the **built** binary in a temp git repo.

### Blocked
- none

### Notes for next agent
- Tests that use real git must pass `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` so the developer's config (signing, hooks paths) can't leak in.
- `validate --fix` does not stage/commit its changes (no author involved); the human commits them.

## 2026-10-12 — M1 slice 1.4b write commands (branch `feat/m1-cli-write`, stacked on `feat/m1-cli-read`)

### Done
- `@aimem/core` `ops/write.ts`: `resolveAuthor` (flag → AIMEM_AUTHOR), `bodyTemplate`, `findLikelyDuplicate` (title Jaccard ≥ 0.7 or title+summary ≥ 0.5, same type, current), `addRecord` (all checks before any write; supersede in the same step), `updateRecord` (`--set` splice, empty value deletes, protected fields, handoff/external refusals), `supersedeRecord`, `verifyRecords` (humans only). Every write refreshes INDEX.md.
- CLI: `add <type>`, `decide`, `remember`, `incident`, `runbook`, `update`, `supersede --by`, `verify`; `--body` / `--body -` (stdin) / `--body-file`; `--author`; template printed on missing body. `CliDeps.stdin` added.
- Contracts: add/update/verify JSON files. 04 §4 wording clarified (human decision: missing body writes nothing).

### Not done (slice 1.4c)
- Author from `git config user.name`; `write_policy.agent_commits` (stage/commit) via `core/git` + execa with real temp-repo tests; `validate --fix` (V015 rename, V007 back-links).
- `link`, `discard`, `move`, `review` (later).

### Next
- Plan 1.4c.

### Blocked
- none

### Notes for next agent
- An agent `update` on a verified record keeps `trust: verified` (spec is silent); consider demoting in a later decision.
- `addRecord` writes the new file then the superseded one; a crash between them leaves V007, which `validate --fix` (1.4c) will repair.

## 2026-10-12 — M1 slice 1.4a CLI foundation + read commands (branch `feat/m1-cli-read`, stacked on `feat/m1-index`)

### Done
- New package `aimem` (`packages/cli`, `commander`): in-process `run(argv, deps)` with injected fs/clock/random/env/cwd/stdout/stderr; `bin.ts` entry. Global flags `--json --yes --dir --quiet --verbose`; 04 §7 envelopes; `EXIT_CODES` per error code.
- Commands: `init` (`--solo/--team/--project/--repo/--roles/--force/--no-intake`; writes project.yaml, type dirs + .gitkeep, .gitignore/.gitattributes lines, INDEX.md; prints the 7 intake questions), `show` (`--raw`, `--links`), `list` (`--status --trust --tag --stale`), `search` (all 04 flags; `--mode hybrid` warns, uses lexical), `validate [--strict]`, `index`.
- `USAGE` error code added (schema + 04 §7, human-approved); 04 §7 exit-code table; validate/init behaviour documented.
- Tests: JSON contract files `packages/cli/test/__snapshots__/contracts/*.json`; exit codes; usage errors; init in temp dirs; read commands on fixtures. Built binary smoke-tested by hand.
- Biome now ignores `__snapshots__` (it was reformatting the JSON contracts).

### Not done
- Writing commands, author resolution, git commit policy, `validate --fix` (slice 1.4b). Interactive intake; adapters (2.5); live branch (M3).
- No automated test of the built `bin.js` yet (the 1.5 e2e will run it).

### Next
- Plan slice 1.4b: `add` (dedupe → exit 3, TODO template → exit 2, trust by author), `update` (refusals), `supersede`, `verify` (humans only), author resolution (flag → AIMEM_AUTHOR → git user.name), `write_policy.agent_commits` via `core/git` (execa), INDEX.md refresh after writes, `validate --fix`.

### Blocked
- none

### Notes for next agent
- Contract JSON changes must be deliberate: update the files with `vitest -u` and say so in the PR.
- Biome reflows long lines; scripted text replacements against formatted files can silently miss. Prefer the Edit tool.

## 2026-10-12 — M1 slice 1.3 index, INDEX.md, BM25 search (branch `feat/m1-index`, stacked on `feat/m1-validate`)

### Done
- `@aimem/core`: `buildIndex` (pure, order-independent) / `loadIndex` / `readNotebookFiles` (validator now reuses it); own BM25 `tokenize` + `bm25` (title 3, summary 2, tags 1.5, body 1; no stemming; accent folding); `search` with type/status/tag/role/repo/path filters, `HIDDEN_STATUSES` per 06 §2, ties by id, scores 0..1; `matchGlob`/`globToRegExp`/`staticPrefix`; `renderIndexMd` (03 §8, ≤ 6 KB with "… and N more", no timestamps) + `writeIndexMd` (atomic, only on change).
- Golden files `packages/core/test/__snapshots__/{tiny,medium}.INDEX.md`. Perf: 5k records index + search + render ≈ 0.5 s (budget 3 s).
- Docs: 03 §8 truncation/no timestamps, 04 search default filter, 11 lexical search row.

### Not done
- Index cache on disk (not needed at current speed).
- `.gitattributes merge=ours` for INDEX.md and regeneration hook (M3).

### Next
- Slice 1.4 CLI: `init --solo`, `add`, `show`, `list`, `update`, `supersede`, `verify` with `--json` contracts and exit codes; `validate --fix`.

### Blocked
- none

### Notes for next agent
- Search builds BM25 over the *filtered* candidates, so IDF depends on filters; fine for ranking, don't compare raw scores across different filter sets.
- Golden INDEX.md files change whenever fixture records change; update them deliberately (`vitest -u`).

## 2026-10-12 — M1 slice 1.2 validator + secret scanner (branch `feat/m1-validate`, stacked on `feat/m1-records`)

### Done
- `@aimem/core`: `AimemError`; `findNotebook`/`loadProject` (defaults filled; NOT_INITIALIZED / INVALID_RECORD / SPEC_TOO_NEW); `scanSecrets` (key formats, private keys, JWT, connection strings, assigned secrets, high-entropy tokens; line + `sha256:` fingerprint, never the value) + `.aimem/secretignore`; `validateFiles` (pure) / `validateNotebook` for V001–V018; `freshnessOf`, `contentSha`, `exitCodeFor`.
- Contract met: `messy` and `medium` produce exactly their `expected.yaml`; `tiny` is clean. One positive + near-miss test per code; secret corpus (15 + 15) built at runtime so the repo holds no key-shaped strings. Mutation-checked.
- OQ-23/24/25 resolved (V011 both, V010 skips retired, content_sha = sha256 of LF+trimmed body); spec 03 §9, 09 §4, 16 updated.

### Not done
- `validate --fix` (slice 1.4 with the CLI).
- V006 for refs to *other* projects is skipped (no hub/sibling resolution until M3).
- Unknown `project.yaml` keys are kept but not yet warned about (03 §6).

### Next
- Slice 1.3 index + `INDEX.md` render + BM25 search.

### Blocked
- none

### Notes for next agent
- V008 scans the whole record file (frontmatter too), not just the body; fixtures stay clean.
- A record failing V001/V002/V016 gets only that error (documented in 03 §9).

## 2026-10-12 — M1 slice 1.1 records I/O (branch `feat/m1-records`, stacked on `feat/m0-medium`)

### Done
- M0 checked against docs/13 with evidence: all pass except V006–V018 fixture checks (→ 1.2), spec 03 human review, OQ-1 npm name. OQ-23..26 added to docs/14 (on PR #4).
- New package `@aimem/core` (`yaml` dep): `parseRecordText` (V001 on missing/unclosed/invalid/non-mapping/duplicate-key frontmatter; CRLF+BOM accepted, output LF), `serializeRecord`, `createRecord` (spec key order, flow lists, no line folding), `setField`/`deleteField`/`setBody`, `writeFileAtomic` (temp + rename, temp removed on failure), `readRecordFile`/`writeRecordFile`/`listRecordFiles`, `newId`/`newUniqueId`/`slugify` (`untitled` fallback)/`recordFileName`. Ports: `Fs`, `Clock`, `Random` with node implementations.
- Tests: every tiny/medium/messy file rewrites byte-for-byte; edits change only the edited lines (comments, unknown keys, order kept); YAML gotchas auto-quoted; fast-check round trip; simulated write/rename failure leaves original and no temp file. Mutation-checked.
- Spec 03: slug folding + `untitled`; edit/line-ending rules.

### Not done
- Inline comment on an *edited* line is dropped (re-rendered); untouched lines keep theirs.
- `project.yaml` loading and notebook discovery (needed by 1.2 validator).

### Next
- Slice 1.2 validator V001–V018 + secret scanner against `messy/expected.yaml`; settle OQ-23/24/26.

### Blocked
- none

### Notes for next agent
- Full YAML re-stringify normalises spacing (`[ a ]`, comment gaps), so edits splice only the affected `key: value` lines (`records/text.ts` `pairSpan`). Don't "simplify" to `doc.set` + `toString` — the edit test and byte-identity test will fail.

## 2026-10-12 — M0 slice 0.3b `medium` fixture (branch `feat/m0-medium`, stacked on `feat/m0-fixtures`)

### Done
- `fixtures/projects/medium`: 127 records describing **aimem itself** (human choice): ADRs/OQs as decisions, roadmap slices as tasks, real gotchas as memories, handoffs, plus incidents/runbooks/schema/testcases.
- `expected.yaml`: every file → codes (only V010 on 7 stale + 2 expired) and `groups` (5 supersede chains incl. one 3-deep, stale, expired, inferred, 15 Indonesian, 8 paraphrase, 8 traps).
- `fixtures-medium.test.ts`: counts/mix, schema, file names, refs + supersede consistency, no V011, word/summary/role/handoff-section checks, manifest = computed freshness, group consistency, authors.
- `fixtures/README.md`: readable group map.
- M0 deliverables complete once #1–#4 merge.

### Not done
- Eval cases (`fixtures/evals/medium.yaml`) — slice 2.2.
- OQ-1 npm name check; GitHub `main` protection (human).

### Next
- Close M0 (docs/17 "Close the milestone" prompt), then plan slice 1.1 records I/O.

### Blocked
- none

### Notes for next agent
- Content was rendered by a throwaway generator (not committed); the markdown files are the source of truth.
- Dates before 2026-10 are synthetic; authors are only `human:akbar` and agent tools (no invented people).
- Records dated 2026-10-12 use time 00:00:00 = the fixture clock.

## 2026-10-12 — M0 slice 0.3a fixtures `tiny` + `messy` (branch `feat/m0-fixtures`, stacked on `feat/m0-schema`)

### Done
- `fixtures/projects/tiny`: 8 clean records (2 per core type), fictional "acme-ledger" money/ledger story.
- `fixtures/projects/messy`: 23 record files, one problem each, covering every code V001–V018; `expected.yaml` maps file → codes (validator contract for 1.2), clock `2026-10-12T00:00:00Z`.
- `fixtures/README.md`. Test-only loader (`packages/schema/test/fixture-loader.ts`, `yaml` dev dep) + `fixtures.test.ts`: tiny is schema-clean, names/links consistent; messy V001–V005 match manifest exactly; manifest covers all 18 codes.
- `isValidSlug` / `SLUG_RE` in `@aimem/schema` (03 §2: `a-z0-9-`, ≤ 60).
- PRs jamalakbara/aimem#1 (0.1) and #2 (0.2) opened.

### Not done
- `medium` fixture (slice 0.3b).

### Next
- Plan 0.3b `medium` (~120 records, supersede chains, stale items, some Indonesian content for OQ-15 / 15 evals).

### Blocked
- none

### Notes for next agent
- YAML gotchas hit while authoring: `summary: Done: x · Next: y` is invalid plain YAML (V001); an all-digit `content_sha` parses as a number (V002). The 1.1 serializer must quote such scalars.
- `dec-0000001f` expects both V017 and V018 (placeholder sha can't match the body); one-problem-per-file rule bent there on purpose.
- V011 expected on both decisions of the pair.

## 2026-10-12 — M0 slice 0.2 `@aimem/schema` (branch `feat/m0-schema`, stacked on `feat/m0-scaffold`)

### Done
- Zod 4 schemas: `baseFrontmatterSchema` (status = any string, for V002), `recordSchema` (discriminated union per type with allowed statuses + type fields, for V004), `sourceSchema`, `externalLinkSchema`, `projectSchema` (03 §6 + 15 §11).
- Constants: types/dirs/prefixes/statuses, `DEFAULT_STATUS` (decision = `proposed`), `DEFAULT_PRIORITY`, trust weights, body sections, reserved tags, `ERROR_CODES` (exactly 04 §7; draft's `USAGE` dropped). `INACTIVE_STATUSES` dropped. ID/ref regexes, `isValidId`, `typeFromId`, `parseRef`. `PROJECT_DEFAULTS`.
- JSON Schema export: `exportJsonSchemas()`; `pnpm build` writes `dist/record.schema.json`, `dist/project.schema.json`.
- 77 tests incl. fast-check round-trip (idempotent parse, unknown keys kept, JSON round-trip, ID regex) and JSON Schema snapshot.
- Spec 03: default-status column in §4, `kind` optional, `all` role clarified, V009 vs V002 for summary, "schemas never inject defaults".
- Remote `origin` = github.com/jamalakbara/aimem (not pushed yet).

### Not done
- `newId`/`slugify` (moved to 1.1, core, with injected random). Cross-field rule `managed_by: external ⇒ source` is not in the exported JSON Schema (Zod refine).

### Next
- Slice 0.3 fixtures `tiny`, `medium`, `messy`.

### Blocked
- none

### Notes for next agent
- `aimem` field accepts any positive int so the validator can emit V016; `summary` has no length cap in the schema (V009 warns).
- Incident `started`/`resolved_at` typed as plain strings (03 gives no format).

## 2026-10-12 — M0 slice 0.1 monorepo scaffold (branch `feat/m0-scaffold`)

### Done
- `git init`; first commit = docs + AGENTS.md + CLAUDE.md on `main`.
- Scaffold: pnpm workspace, `tsconfig.base.json` + root solution `tsconfig.json`, `tsconfig.test.json` (strict typecheck of tests), Biome (recommended preset), Vitest, `.nvmrc` (24), engines `>=22`.
- `@aimem/schema` reduced to `SPEC_VERSION` + one smoke test; `pnpm lint && pnpm typecheck && pnpm test` green.
- CI: `.github/workflows/ci.yml` — lint, typecheck, test on ubuntu+macos × Node 22/24.
- Pre-existing untested draft (core, cli, full schema) parked in `wip/` (see `wip/README.md`). Deleted ~24 empty `_tmp_*` leftovers from repo root.

### Not done
- GitHub remote, `main` branch protection (human step, docs/17 §2).
- OQ-1 npm name availability check (M0 item).

### Next
- Slice 0.2 `@aimem/schema`: Zod schemas for 4 core types + `project.yaml`, JSON Schema export, fast-check round-trip tests. Start from `wip/schema/index.ts`.

### Blocked
- none

### Notes for next agent
- Draft deviations to fix when un-parking: side effects not injected (Date/env/fs/`execFileSync`), schema lacks `source`/`external`/`hub`/`repos`/`retrieval`/`claims`/`server` types, `DEFAULT_STATUS.decision = "accepted"` and `INACTIVE_STATUSES` are not in spec 03 — decide in 0.2 (propose spec change or drop).
- Biome 2.5 `migrate` rewrote `recommended: true` to `preset: "none"` (disables all rules); fixed to `"recommended"`.
- Root `package.json` is `"type": "module"` so `vitest.config.ts` loads as ESM.
