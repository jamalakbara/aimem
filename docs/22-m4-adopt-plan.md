# 22 — M4 Adopt Plan

Status: **approved by the owner (2026-11-22) with the recommended defaults below.** Slices land one PR at a time; this section records which are implemented: **4.1** (scan and `--dry-run`), **4.2** (writing drafts; manifests become a separate "Tech stack" memory instead of being folded into the overview, so an adopted overview keeps its evidence key; migrations → `schema`; CI/Makefile/scripts → runbook), **4.4** (`--agent-plan`, `aimem add --evidence`), **4.5** (`aimem review`, `aimem discard`, review debt in `status`, the inferred-supersede rule). M3 is complete (21 §3.7). This plan turns 08 §2 and the M4 entry in 13 into PRs. 04 §`aimem adopt` and §`aimem review` describe the commands; 03 already has `trust: inferred`, `evidence` and the reserved tag `adopted`.

M4 acceptance (13): the `adopt-me` fixture yields at most 40 records, all `inferred`, each with evidence, and a second run adds nothing. The author adopts one real running project and verifies or discards the drafts in under an hour.

## Slice order

| Slice | Scope | Proof |
|-------|-------|-------|
| 4.1 | `adopt-me` fixture; scan framework (candidates with evidence, `--dry-run`, `--sources`, 200 KB file limit); extractors for README/docs, ADRs and agent-instruction files | Dry-run snapshot of `adopt-me` is deterministic (two runs identical); every candidate has evidence |
| 4.2 | Write mechanical drafts: `trust: inferred`, tag `adopted`, cap (`--max-records`, default 40), idempotency by evidence; stack facts from manifests folded into the overview; CI/Makefile runbook skeleton; `schema` candidates from migrations | `adopt-me` yields ≤ 40 valid records, `validate --strict` clean; a second run adds nothing |
| 4.3 | Git extractor: hotspot paths, reverts and `fix:` clusters → gotcha candidates; `--since`; optional PR mining with `--sources prs` (uses `gh`, off by default) | Fixture git history built in the test; PR mining tested with recorded `gh` output |
| 4.4 | `--agent-plan`: remaining candidates to `.aimem/.cache/adopt-plan.json` plus the agent prompt | JSON contract snapshot; agent-written records stay `inferred` |
| 4.5 | `aimem review` queue (verify, edit+verify, skip, discard) with a non-interactive form; discard rules; review debt in `status`; 08 §2.2 rule 2 (an `inferred` record cannot be the only basis of an accepted supersede) | Interactive flow with scripted stdin; JSON contract; discard refused for verified or linked records |

Each slice is one PR (4.2 and 4.5 may split further at review). 4.1–4.2 already give a usable `adopt`; 4.5 is needed for the one-hour acceptance.

## Decisions to confirm before coding

1. **Project overview record.** One pinned `memory` titled "Project overview", built from the README plus stack facts from manifests (package.json, pyproject, go.mod, Dockerfile, compose). Recommended: if the notebook already has a pinned overview (as this repo does), adopt reports a candidate instead of writing a second one.
2. **Evidence format and idempotency.** `evidence` entries are `path`, `path#heading-slug`, `git:<sha>` or a URL. A candidate whose evidence set is already on a record is skipped. Recommended: adopt never rewrites existing records; when the source file changed since adoption it reports "source changed" in the output so a person can update the record.
3. **Author and trust.** Records carry the caller's author (`human:` or `agent:`), but always `trust: inferred`, whatever `write_policy` would otherwise give. `write_policy` then applies once for the whole run: one commit or branch `aimem: adopt N records`, not N commits.
4. **Cap and priority.** When there are more candidates than `--max-records`, keep them in this order: ADRs → agent-instruction sections → overview → runbook → schema → gotchas → PRs. The output reports how many candidates were cut and suggests `--agent-plan` for them.
5. **Embeddings.** One background vector refresh after the batch (T1), not one per record.
6. **Review for agents and CI.** `aimem review --json` lists the queue and changes nothing. Verifying stays human-only (the M3.7 rule). An agent may `skip`, but not `discard`: discarding deletes a file.
7. **Discard.** Deletes the file and regenerates `INDEX.md`. Allowed only for records that were never verified and that no record links to (08 §2.1, the one exception to "never delete"). Otherwise use `supersede`.
8. **Monorepo (OQ-3).** Deferred. M4 adopts into the root `.aimem/` and sets `paths:` from the evidence location, so package-scoped briefings still work.
9. **Network.** Everything is offline except `--sources prs`, which needs `gh` and is off by default. Missing `gh` is a warning, not a failure.

## 4.1 — Fixture and scan

- New fixture `fixtures/projects/adopt-me`, as listed in 12 §2: README with run/test/deploy sections, `docs/adr/` with two MADR files and one Nygard file (one superseded), `CLAUDE.md` and `AGENTS.md` with custom sections, `package.json`, a Dockerfile, SQL migrations, a CI workflow and a Makefile. Git history is created by the test helper, not checked in.
- Core: `packages/core/src/adopt/` with `scan.ts` (walk, size limit, ignore `.aimem/`, `node_modules`, `.git`, binary files), one module per extractor, and a `Candidate` type `{ type, title, summary, body, status?, tags, paths, evidence[], source }`.
- CLI: `aimem adopt --dry-run [--sources …] [--json]` prints the candidates grouped by source. Without `--dry-run`, 4.1 refuses with a `USAGE` message that points to `--dry-run` until 4.2 lands.
- Secret scanner runs on every candidate body. A hit drops the candidate with a warning naming the file, never the secret.

**Tests first:** determinism (two scans equal), 200 KB skip, secret drop, ADR status mapping (accepted, superseded, proposed, deprecated → 03 statuses), agent-instruction sections preserved verbatim and tagged `imported`, the managed aimem block in `AGENTS.md` ignored.

## 4.2 — Drafts

- Write through the existing core write ops so validation, INDEX rendering, duplicate checks and `write_policy` stay in one place. A duplicate-likely hit is skipped and reported, not forced.
- `--max-records` (default 40) and the priority order from decision 4.
- Second run: zero writes, and the output says "nothing new; N records already adopted".

**Tests first:** acceptance on `adopt-me` (≤ 40, all `inferred`, all with evidence, `validate --strict` clean); idempotency; cap ordering; one commit in `commit` mode; a branch in `pr` mode; JSON contract snapshot.

## 4.3 — Git and PRs

- Hotspots: top paths by commit count over `--since` (default 1 year), excluding lockfiles and generated files. Gotchas: paths with reverts or several `fix:` commits, evidence `git:<sha>` (at most 5 per candidate).
- PRs: `gh pr list --state merged` plus `gh pr view`. Candidates are PRs with long descriptions or `decision`/`architecture` labels; the URL goes into `external`.

## 4.4 — Agent plan

- `.aimem/.cache/adopt-plan.json`: `{ version, generated, candidates[] }`, the candidates left after the cap or that need judgement (git gotchas, long docs sections). The printed prompt follows 08 §2.1.

## 4.5 — Review

- `aimem review` walks `inferred` records, unreviewed `agent` records, stale records and likely duplicates (04 §`aimem review`). Keys: `v`, `e` (opens `$EDITOR`, then verifies), `s`, `d`, `q`.
- Non-interactive: `aimem review --json` (list only), plus the existing `aimem verify <ref>` and `aimem discard <ref>` (specified in 04, not implemented yet).
- `status`: inferred records older than 60 days and still unreviewed are listed as review debt.
- Supersede rule: superseding with `status: accepted` fails with `USAGE` when every record in `links` is `inferred`.

## Expected files

| Area | Files |
|------|-------|
| Core | `packages/core/src/adopt/*`, `packages/core/src/ops/discard.ts`, `packages/core/src/status/status.ts`, `packages/core/src/index.ts` |
| CLI | `packages/cli/src/commands/adopt.ts`, `packages/cli/src/commands/review.ts`, `packages/cli/src/run.ts` |
| MCP | none in M4; `review` and `adopt` stay CLI-only (owner may change this at approval) |
| Fixtures and tests | `fixtures/projects/adopt-me/**`, tests under `packages/core/test/adopt*` and `packages/cli/test/adopt*`, `review*` |
| Docs | 04 (`adopt`, `review`, `discard`), 08 §2 (final behavior), 13 (M4 status) |

## Out of scope

Google and upload connectors (M4b), the web review queue (M5), LLM extraction inside `adopt` itself (only `--agent-plan`).
