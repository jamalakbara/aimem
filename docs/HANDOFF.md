# Handoff log

Append-only session log until M1 ships `aimem handoff` (docs/17 §1 rule 5). Newest first.

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
