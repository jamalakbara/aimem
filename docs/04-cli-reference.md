# 04 — CLI Reference

Binary: `aimem`. Designed for two audiences: humans (interactive) and agents (non-interactive, machine-readable).

## 1. Global behaviour

| Flag | Meaning |
|------|---------|
| `--json` | Machine-readable output on stdout; logs go to stderr |
| `--yes`, `-y` | Never prompt; use defaults. **Agents must always pass this or run with `AIMEM_NONINTERACTIVE=1`** |
| `--dir <path>` | Start directory (default: cwd; walks up to find `.aimem/`) |
| `--project <slug>` | Override project |
| `--offline` | Do not fetch/push or contact the server |
| `--quiet` / `--verbose` | Log level |

Environment: `AIMEM_TOKEN` (server token), `AIMEM_AUTHOR` (e.g. `agent:claude-code`), `AIMEM_NONINTERACTIVE`, `AIMEM_HOME` (cache dir).

Exit codes: `0` ok · `1` warnings (strict mode) / not found · `2` validation or usage error · `3` conflict (e.g. claim lost, likely duplicate) · `4` network/sync failure (operation may have partially applied — see message).

Author resolution: `--author` flag → `AIMEM_AUTHOR` → git `user.name` as `human:<handle>` (slugified, e.g. `Dana Example` → `human:dana-example`). None of these → `USAGE`.

## 2. Setup commands

### `aimem init`
Create `.aimem/` in the current repo.
```
aimem init [--solo | --team] [--project <slug>] [--repo <name>]
           [--hub <git-url>] [--sync none|git|server] [--roles dev,pm,qa,...]
           [--adapters agents,claude,cursor,copilot] [--no-intake] [--upgrade]
```
`--upgrade` re-runs setup on an existing notebook after a mode/sync/hub change (adds missing files, members, live branch) without touching records.
- Writes `project.yaml`, empty type dirs, `.gitignore` entry for `.aimem/.cache/`, `INDEX.md`.
- Generates adapter blocks (see 06) in the selected files.
- Unless `--no-intake`, runs the intake (08 §1) interactively, or prints intake questions in `--json` mode so an agent can ask the human. *(v0.1: the questions are printed in both modes; the interactive intake comes later.)*
- Refuses an existing notebook (`USAGE`) unless `--force`, which re-creates `project.yaml` and missing files but never touches records.

### `aimem adopt`
Bootstrap from an existing project (08 §2).
```
aimem adopt [--dry-run] [--since <date|tag>] [--sources readme,docs,adr,git,prs,schema,ci,agents]
            [--max-records 40]
```
Creates draft records with `trust: inferred`. `--dry-run` prints what would be created.

### `aimem adapters`
```
aimem adapters list
aimem adapters add --file <path>        # add a custom target file
aimem adapters sync [--targets ...]     # regenerate the aimem blocks inside AGENTS.md etc.
aimem adapters remove
```

### `aimem hub init`
Turn the current repo into a hub (multi-repo projects): creates `.aimem/` with `scope: hub` and prints the `hub:` snippet to add to each member repo's `project.yaml`.

## 2b. Import and connector commands

### `aimem import <file|url>`
Ingest a document or spreadsheet (16).
```
aimem import <path|google-url> [--as auto|decision|memory|runbook|incident|tasks|testcases]
             [--template <name>] [--extract none|llm] [--dry-run] [--keep-original]
```
Creates externally-owned records (`managed_by: external`), idempotent by `source`. Reports per-row/per-item errors. `--extract llm` (opt-in) drafts records from free-form text as `trust: inferred`.

### `aimem sources`
```
aimem sources list
aimem sources add google --folder <id>
# aimem sources add odoo ...        # deferred (ADR-016); see 16 §6
aimem sources status
aimem sources sync [<id>] [--dry-run]
aimem sources remove <id>
```
Manual sync from any machine that can reach the sources (e.g. on the VPN). With a server, the same sources are synced on a schedule (07 §4.6).

### `aimem templates`
```
aimem templates list
aimem templates export <type> --format xlsx|md|csv     # blank templates for non-developers
```

### `aimem detach <ref>`
Make an externally-owned record notebook-owned permanently (stops syncing).

## 3. Reading commands

### `aimem context` (most important)
```
aimem context [--task "<free text>"] [--ref <task-ref>] [--paths <glob>...]
              [--role dev|qa|...] [--budget <tokens>] [--format md|json]
              [--include-superseded] [--no-live] [--explain]
              [--mode lexical|hybrid] [--deep]
```
Returns the briefing (algorithm in 06 §2). With no args, infers paths from `git diff --name-only` + `git status`, and the task from the current branch name (reported in `data.inferred`).
`--explain` prints why each record was selected and its score (a table after the briefing, not counted in the budget; always present in JSON as `explain`).
`--format json` prints the briefing object; `--json` wraps it in the 04 §7 envelope (the markdown is in `data.markdown`). `--budget` must be ≥ 300. v0.1: `--mode hybrid` warns and uses lexical until slice 2.3; `--no-live` is accepted (claims arrive in M3); `--deep` is reserved and ignored with a warning (OQ-30).

### `aimem search <query>`
```
aimem search "<query>" [--type decision,memory] [--status ...] [--tag ...] [--role ...]
                       [--repo ...] [--paths <glob>] [--limit 10] [--include-superseded]
                       [--mode lexical|hybrid]
```
By default hides records that are `superseded`, `rejected`, `cancelled`, `done` or `retired` (as `context` does, 06 §2); `--include-superseded` shows them, and an explicit `--status` shows the listed statuses.
### `aimem ask "<question>"`
Retrieval-augmented answer with citations (15 §10).
```
aimem ask "why did we choose postgres for the ledger?" [--role pm] [--limit 8] [--json]
```
Requires `retrieval.llm` to be configured; otherwise prints how to enable it. Answers only from retrieved records, cites every claim as `[ref]`, says "not found in the notebook" when evidence is weak, and reports how many sources were `verified` / `agent` / `inferred`.

### `aimem show <ref>`
Print one record (`--raw` for file text, `--links` to expand linked summaries).
### `aimem list [type]`
Table of records with filters (`--status`, `--stale`, `--trust inferred`, `--mine`).
### `aimem status`
Project overview: counts, open p0/p1 tasks, live claims, stale items, unreviewed agent records. `--json` data: `project, mode, sync, total, counts, urgentTasks, stale, unreviewed {agent, inferred}, problems, lastHandoff, claims`.
### `aimem log [--since 7d]`
Recent record activity (from git history of `.aimem/`).

## 4. Writing commands

### `aimem add <type>`
```
aimem add decision --title "..." --summary "..." [--status accepted] [--roles dev,db]
                   [--tags a,b] [--paths "src/x/**"] [--link <ref>...] [--supersedes <ref>]
                   (--body-file <path> | --body - | --body "text")
```
- `--body -` reads stdin. Without a body, **nothing is written**: the type template with `TODO` markers is printed (in `--json`: `error.details.template`, code `INVALID_RECORD`) and the command exits 2, so agents never commit empty records. `--body` and `--body-file` are mutually exclusive.
- Type-specific flags: `--kind` (memory), `--priority`, `--assignee` (task).
- Refuses (nothing written): invalid status/fields or a multi-line/over-long summary (`INVALID_RECORD`), unknown `--link`/`--supersedes` targets (`INVALID_RECORD`/`NOT_FOUND`), possible secrets (`SECRET_DETECTED`).
- Runs a **dedupe check**: a current record of the same type whose title is very similar (word overlap ≥ 70%) or whose title + summary overlap ≥ 50% is a likely duplicate; it is named in `error.details` and the command exits 3 unless `--force` (agents should then `aimem show` it and update/supersede instead).
- Sets `trust: agent` for `agent:*` authors, `verified` for `human:*`.
- Applies `write_policy.agent_commits` (`none|stage|commit|pr`; default `commit` in solo mode, `stage` otherwise) to **agent** writes only; human writes are left for the human to commit. Only the files the command wrote are staged/committed (`git commit --only`), so other staged work is never included. Commit message `aimem: <verb> <ref> <title>` plus a trailer `Aimem-Author: <author>`. `pr` currently stages and warns. Outside a git repo, without git, or when git refuses (e.g. a failing hook) the records stay written, a warning is added, and the exit code is 0. Write commands report `data.git`: `none | staged | committed | skipped | failed`.

Shortcuts: `aimem decide`, `aimem remember` (memory), `aimem incident`, `aimem runbook` — thin aliases for `add <type>` with type-specific flags.

### `aimem update <ref>`
Edit fields/body of an existing record (`--set status=done`, repeatable; list fields take comma-separated values; an empty value removes the field; `--body`, `--body-file`). Only the edited lines change. Refused for `handoff` bodies unless `--force` (`PERMISSION_DENIED`), for externally-owned records (`READONLY_EXTERNAL`; edit at the source or `aimem detach` first), and for tool-managed fields `aimem id type created updated trust verified author supersedes superseded_by managed_by source` (`INVALID_RECORD`; use `supersede` / `verify`).
### `aimem supersede <old-ref> --by <new-ref>`
Links both records, sets old to `superseded`.
### `aimem verify <ref>...`
Set `trust: verified`, `verified: today`. Human authors only.
### `aimem link <ref> <ref>`
Add a bidirectional link.
### `aimem move <ref> --to hub|<repo>`
Move a record between the hub and a repo, preserving its ID and leaving a pointer stub (`status` unchanged, body replaced by a link) in the old place until the next release.
### `aimem review`
Interactive queue over records that need human attention: `trust: inferred`, unreviewed `trust: agent`, stale, possible duplicates. Per item: verify · edit+verify · skip · discard.
### `aimem discard <ref>`
Delete a record. Allowed **only** if it was never `verified` and nothing links to it (ADR-007 exception). Everything else is superseded.

### `aimem handoff`
```
aimem handoff [--task <ref>] --done "..." --not-done "..." --next "..." [--blocked "..."] [--notes "..."]
              [--from-file <path>] [--release-claims] [--commit]
```
Writes a `handoff` record, releases this session's claims (default), updates `INDEX.md`.
- `--done`, `--not-done`, `--next` are required (from flags or `--from-file`, a markdown file with `## Done` / `## Not done` / `## Next` / `## Blocked` / `## Notes for next agent`; flags win). `--blocked` and `--notes` default to `none`.
- Title `Handoff <date>: <first line of Done>` (≤ 120), summary `Done: … · Next: …` (≤ 200, cut with `…`), `branch` from git, `--task` must be an existing task.
- Applies `write_policy` like other writes; `--commit` commits it regardless of policy or author.
- v0.1: claims arrive in M3, so `--release-claims` is accepted and reports `claimsReleased: 0` with a warning.

## 5. Task and claim commands

```
aimem task create --title "..." [--priority p1] [--assignee rina] [--roles dev,qa] [--paths ...]
aimem task list [--status open] [--mine] [--claimed]
aimem task claim <ref> [--paths "src/webhooks/**"] [--ttl 180m] [--note "..."] [--share] [--local]
aimem task heartbeat [<ref>]            # extend TTL; `context` also heartbeats active claims
aimem task release <ref> [--status done|open|blocked|review]
aimem task status <ref> <status>
aimem live [--watch]                    # show all live claims and presence (--watch streams updates; server mode)
```
`--share` lets another holder co-claim (pairing). `--local` creates an unsynced local claim when the remote/server is unreachable; it is pushed on the next successful sync and clearly marked until then (07 §2.4).
`claim` semantics: atomic. Exit `3` with the current holder printed if someone else holds a non-expired claim. `--steal` is allowed only for expired claims or by a human (`--steal --reason "..."`), recorded in the claim log.

## 6. Maintenance commands

| Command | Purpose |
|---------|---------|
| `aimem validate [--strict] [--fix] [--project]` | Run rules V001–V018 (03 §9). `--fix` first repairs safe issues — renames files that do not start with `<id>-` (V015; never overwrites), adds the missing half of a one-sided supersede link (V007), raises `updated` that is earlier than `created` — and reports them in `data.fixed` / `data.skipped`; it never deletes or resolves conflicts |
| `aimem index [--embeddings] [--rebuild]` | Regenerate `INDEX.md`; rebuild the lexical index and (re)compute embeddings; `--rebuild` discards the cache first. `data.embeddings` reports `{available: false, reason}` (exit 0, warning) or `{available: true, provider, chunks, built, reused, removed, rebuilt, reason?, excluded[]}` |
| `aimem stale [--mark]` | List stale records; `--mark` sets memory status to `stale` |
| `aimem doctor` | Diagnose environment: git, remote access, server reachability, adapter presence, schema version, embedding provider/model status, and exactly what content would leave the machine. Read-only, no network; each check is `ok`/`warn`/`info` in `data.checks`; always exits 0 (use `validate --strict` as the CI gate) |
| `aimem sync [--compact]` | Fetch durable state, push/pull live branch, or reconcile with server. `--compact` (maintainers) recreates `aimem-live` from its current tree to drop heartbeat history |
| `aimem migrate` | Upgrade files to the current spec major |
| `aimem export [--format html\|json\|md]` | Static export of the whole notebook (backup / read-only sharing) |
| `aimem config get\|set\|list` | Edit `project.yaml` safely |
| `aimem serve mcp [--http <port>]` | Start the MCP server (05) |
| `aimem serve web` | Start the web viewer locally against the working tree |

## 7. Output contracts (for agents)

`--json` output always has:
```json
{ "ok": true, "command": "context", "data": { }, "warnings": ["..."] }
```
or on failure:
```json
{ "ok": false, "error": { "code": "CLAIM_CONFLICT", "message": "...", "details": { "holder": "human:rina", "since": "..." } } }
```
Error codes (stable) and their exit codes:

| Code | Exit | Code | Exit |
|------|------|------|------|
| `NOT_FOUND` | 1 | `READONLY_EXTERNAL` | 2 |
| `NOT_INITIALIZED` | 2 | `SOURCE_AUTH` | 2 |
| `INVALID_RECORD` | 2 | `USAGE` (unknown command/flag, bad value, missing argument) | 2 |
| `PERMISSION_DENIED` | 2 | `DUPLICATE_LIKELY` | 3 |
| `SECRET_DETECTED` | 2 | `CLAIM_CONFLICT` | 3 |
| `SPEC_TOO_NEW` | 2 | `SYNC_FAILED`, `SOURCE_UNREACHABLE` | 4 |

`aimem validate`: with errors it fails with `INVALID_RECORD` and `error.details = {errors, warnings, issues}` (exit 2); otherwise `ok: true` with the same `data`, exit 1 under `--strict` if there are warnings, else 0.

## 8. Example sessions

**Agent start**
```
$ aimem context --task "fix xendit webhook retries" --format md
$ aimem task claim tsk-3f9a1b2c --paths "services/webhooks/**"
```
**Agent records a finding**
```
$ aimem remember --title "Xendit retries after 30s" \
    --summary "Xendit retries webhook delivery after 30s; handlers must be idempotent." \
    --kind gotcha --roles dev,qa --paths "services/webhooks/**" --body - <<'EOF'
Observed in logs 2026-10-07. Retries reuse the same event id. Verify with the sandbox dashboard.
EOF
```
**Agent ends session**
```
$ aimem handoff --task tsk-3f9a1b2c --done "Idempotent handler" --not-done "Retry tests" \
    --next "Add tests for duplicate delivery" --blocked "none"
```
