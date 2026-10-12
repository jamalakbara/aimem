# 08 — Starting a Project: `init` and `adopt`

Two entry paths produce the same structure. They differ in where the first records come from.

| | New project (`aimem init`) | Running project (`aimem adopt`) |
|---|---|---|
| Starting knowledge | Questions answered by a human | Existing artifacts: README, docs, ADRs, git/PR history, schema, CI, agent files |
| Trust of first records | `verified` (human answered) | `inferred` (must be reviewed) |
| Coverage | Complete from day one | Essentials only; grows over time |
| Main risk | Skipping the intake | Agents trusting unverified guesses |

## 1. `aimem init` (new or empty notebook)

Steps:
1. Detect repo, existing `.aimem/` (refuse unless `--force`), git remote, project slug candidates.
2. Choose mode: solo / team (+ optional hub, sync).
3. Create files: `.aimem/project.yaml`, type directories (each with `.gitkeep`), `.gitignore` (+`.aimem/.cache/`), `.gitattributes` (INDEX merge rule), `INDEX.md`.
4. Generate adapter blocks (06 §4).
5. If `sync: git` and a remote exists: create/push the `aimem-live` branch.
6. Install optional git hooks (`post-merge` → `aimem index`, `pre-commit` → `aimem validate`).
7. **Intake** (skippable): the following questions create the first records. In `--json` mode the questions are emitted so an agent can ask the human and then call `aimem add`.

### 1.1 Intake questions → records
| # | Question | Creates |
|---|----------|---------|
| 1 | What is this project, who uses it, what does success look like? | `memory` (kind `fact`, tag `pinned`, title "Project overview") |
| 2 | Stack and key libraries; how to run, test, deploy locally? | `memory` (`howto`, `pinned`) "How to run and test" |
| 3 | Conventions agents must follow (style, branching, PR rules, forbidden actions)? | `memory` (`preference`, `pinned`) "Conventions" |
| 4 | Major decisions already made and why (database, framework, hosting)? | one `decision` each (status `accepted`) |
| 5 | What are the first tasks / milestones? | `task` records |
| 6 | Who does what (roles, handles)? | `members` in `project.yaml` |
| 7 | Known external systems and their gotchas (payment, ads APIs, ...)? | `memory` (`gotcha`) each |

Human-entered records get `trust: verified`.

## 2. `aimem adopt` (existing project)

Goal: a **small, reviewed, useful** starting notebook — not an archive. Default cap 40 records.

### 2.1 Pipeline
```
scan  →  candidates (with evidence)  →  draft  →  review  →  verified records
(deterministic)                       (mechanical or agent)   (human)
```

**Phase A — Scan (deterministic, offline).** Extractors read sources and emit *candidates*, each with `evidence` (file paths/URLs/commits).

| Source | Extractor output |
|--------|------------------|
| `README*`, `docs/**` | "Project overview" and "How to run/test/deploy" candidates (section-level) |
| `docs/adr/**`, `adr/**`, `decisions/**` (MADR/Nygard formats) | One `decision` per file; status mapped from ADR status |
| `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/**`, `.github/copilot-instructions.md` | One `memory` per section (kind `preference`/`howto`); preserved verbatim, tagged `imported` |
| Package manifests, lockfiles, Dockerfile, compose | Stack facts → folded into "Project overview" |
| Migrations / ORM schema / SQL dumps | `schema` candidate per datastore (objects list, invariants if comments exist) |
| CI/CD config, Makefile, scripts | "Build and deploy" `runbook` candidate |
| Git history | Hotspot paths (most changed), reverts and `fix:` commits clustered by path → gotcha candidates |
| PRs/issues (via `gh`/API if available, optional) | Merged PRs with long descriptions or `decision`/`architecture` labels → decision candidates; PR/issue links stored in `external` |
| Existing incident/postmortem docs | `incident` candidates |
| Google Docs/Sheets (via connectors, 16) | Optional second pass: `aimem sources sync` after adopt; imported records are externally-owned |

**Phase B — Draft.**
- *Mechanical drafts* (default): imported ADRs, imported agent-instruction sections, README-derived overview, stack facts, CI-derived runbook skeleton. No LLM needed.
- *Agent-assisted drafts* (`aimem adopt --agent-plan`): writes `.aimem/.cache/adopt-plan.json` with remaining candidates + evidence and prints a prompt the user gives to their agent: "For each candidate, read the evidence, write a record with `aimem add`, keep it under 300 words, state uncertainty." Agent-written records are still `trust: inferred`.

**Phase C — Mark.** Every draft gets: `trust: inferred`, `status` as appropriate (decisions from ADRs keep their ADR status; guesses become `proposed`), `evidence: [...]`, tag `adopted`.

**Phase D — Review.** `aimem review` walks the list of `inferred` records:
- `v` verify (→ `trust: verified`, `verified: today`)
- `e` edit then verify
- `s` skip (stays inferred)
- `d` discard (deletes the file; allowed **only** for never-verified records that nothing links to — the one exception to "never delete")
The web app offers the same as a review queue.

### 2.2 Rules to protect against bad guesses
1. Briefings rank `inferred` at weight 0.4 and label them `[inferred]`.
2. `inferred` records may not be the sole basis of an `accepted` decision supersede.
3. Anything inferred older than 60 days and still unreviewed is listed in `aimem status` as "review debt".
4. `adopt` is idempotent: it matches existing records by `evidence` and never duplicates.
5. `adopt --dry-run` is the recommended first run.

### 2.3 Don't backfill everything
After adoption, knowledge grows **where work happens**. Each agent session that touches an area adds what it learned. Old history is only imported if it still affects current work.

## 3. Growing from solo to team, or from one repo to several

| Change | Command | Effect |
|--------|---------|--------|
| Solo → team | `aimem config set mode team` then `aimem init --upgrade` | Adds members, review policy, live branch; no record changes |
| Add realtime | `aimem config set sync server` + `server.url` | Claims move to the server; durable files unchanged |
| One repo → several | Add `repos:` to each `project.yaml`; optionally `aimem hub init` in a new repo | Records stay where they are; cross-repo ones may be moved to the hub with `aimem move <ref> --to hub` (leaves a pointer, preserves ID) |

## 4. Edge cases
- **Monorepo:** one `.aimem/` at the root; use `paths:` for package scoping; `repo:` may name a package. (Open question OQ-3.)
- **Repo with a huge docs folder:** `--max-records` and `--sources` limit the import; extractor skips files over 200 KB.
- **Existing `AGENTS.md` with custom content:** only the managed block is added; nothing else touched.
- **No git remote yet:** sync is `none`/local; upgrade later.
