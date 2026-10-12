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

Author resolution: `--author` flag → `AIMEM_AUTHOR` → git `user.name` as `human:<name>`.

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
- Unless `--no-intake`, runs the intake (08 §1) interactively, or prints intake questions in `--json` mode so an agent can ask the human.

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
Returns the briefing (algorithm in 06 §2). With no args, infers paths from `git diff --name-only` + `git status`, and the task from the current branch name.
`--explain` prints why each record was selected and its score.

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
Project overview: counts, open p0/p1 tasks, live claims, stale items, unreviewed agent records.
### `aimem log [--since 7d]`
Recent record activity (from git history of `.aimem/`).

## 4. Writing commands

### `aimem add <type>`
```
aimem add decision --title "..." --summary "..." [--status accepted] [--roles dev,db]
                   [--tags a,b] [--paths "src/x/**"] [--link <ref>...] [--supersedes <ref>]
                   (--body-file <path> | --body - | --body "text")
```
- `--body -` reads stdin. Without a body in non-interactive mode, a type template is written with `TODO` markers and the command exits 2 (so agents don't commit empty records).
- Runs a **dedupe check**: searches for similar titles/summaries; if a likely duplicate exists, prints it and exits 3 unless `--force` (agents should then `aimem show` it and update/supersede instead).
- Sets `trust: agent` for `agent:*` authors, `verified` for `human:*`.
- Applies `write_policy.agent_commits` (`none|stage|commit|pr`).

Shortcuts: `aimem decide`, `aimem remember` (memory), `aimem incident`, `aimem runbook` — thin aliases for `add <type>` with type-specific flags.

### `aimem update <ref>`
Edit fields/body of an existing record (`--set status=done`, `--body-file`). Refused for `handoff` bodies unless `--force`, and for externally-owned records (`READONLY_EXTERNAL`; edit at the source or `aimem detach` first).
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
| `aimem validate [--strict] [--fix] [--project]` | Run rules V001–V018 (03 §9). `--fix` repairs safe issues (slug mismatch, `updated`, back-links) |
| `aimem index [--embeddings] [--rebuild]` | Regenerate `INDEX.md`; rebuild the lexical index and (re)compute embeddings; `--rebuild` discards the cache first |
| `aimem stale [--mark]` | List stale records; `--mark` sets memory status to `stale` |
| `aimem doctor` | Diagnose environment: git, remote access, server reachability, adapter presence, schema version, embedding provider/model status, and exactly what content would leave the machine |
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
Error codes (stable): `NOT_INITIALIZED`, `INVALID_RECORD`, `DUPLICATE_LIKELY`, `CLAIM_CONFLICT`, `NOT_FOUND`, `SYNC_FAILED`, `PERMISSION_DENIED`, `SECRET_DETECTED`, `SPEC_TOO_NEW`, `READONLY_EXTERNAL`, `SOURCE_AUTH`, `SOURCE_UNREACHABLE`.

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
