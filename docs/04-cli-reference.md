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

Environment: `AIMEM_TOKEN` (server token), `AIMEM_AUTHOR` (e.g. `agent:claude-code`), `AIMEM_SESSION` (claim session), `AIMEM_NONINTERACTIVE`, `AIMEM_HOME` (cache dir), `AIMEM_LIVE_TIMEOUT_MS` (limit for each fetch, push or ls-remote of `aimem-live`, default 10000), `AIMEM_EMBED_SYNC=1` (refresh vectors inside each write instead of in the background, 15 §13).

Exit codes: `0` ok · `1` warnings (strict mode) / not found · `2` validation or usage error · `3` conflict (e.g. claim lost, likely duplicate) · `4` network/sync failure (operation may have partially applied — see message).

Author resolution: `--author` flag → `AIMEM_AUTHOR` → git `user.name` as `human:<handle>` (slugified, e.g. `Dana Example` → `human:dana-example`). None of these → `USAGE`.

## 2. Setup commands

### `aimem init`
Create `.aimem/` in the current repo.
```
aimem init [--solo | --team] [--project <slug>] [--repo <name>]
           [--sync none|git] [--roles dev,pm,qa,...]
           [--adapters agents,claude,cursor,copilot] [--no-intake] [--force] [--offline]
aimem init --upgrade --sync git [--offline]
```

- Solo init uses local sync (`none`). Team init defaults to Git sync when `origin` is configured and local sync otherwise. Pass `--sync none` for local team setup or `--team --sync git` to require Git sync.
- Online Git setup checks or creates `origin/aimem-live` before writing notebook files. A missing required `origin` or failed setup reports `SYNC_FAILED` (exit 4). With `--offline`, Git setup records the configuration and warns that online setup is pending.
- `--upgrade --sync git` enables Git sync for an existing team notebook using `none` or `git` sync, including notebooks created by earlier versions. It updates the sync setting and generated index as needed and preserves records and other config keys. Repeat online after offline init. It reports `project`, `mode` and `files` in the usual JSON envelope.
- Hub setup and server sync are planned for later slices.
- Writes `project.yaml`, empty type dirs, `.gitignore` entry for `.aimem/.cache/`, `INDEX.md`.
- Generates adapter blocks (see 06) in the selected files: `--adapters <list|none>`, default AGENTS.md plus CLAUDE.md if present without an `@AGENTS.md` import.
- Unless `--no-intake`, runs the intake (08 §1) interactively, or prints intake questions in `--json` mode so an agent can ask the human. *(v0.1: the questions are printed in both modes; the interactive intake comes later.)*
- Refuses an existing notebook (`USAGE`) unless `--force`, which re-creates `project.yaml` and missing files but never touches records.

### `aimem adopt`
Bootstrap from an existing project (08 §2).
```
aimem adopt [--dry-run] [--since <date|tag>] [--sources readme,docs,adr,git,prs,schema,ci,agents]
            [--max-records 40]
```
Creates draft records with `trust: inferred`. `--dry-run` prints what would be created.

Status (22 §4.1–4.2): the README, docs, ADR and agent-instruction sources are implemented. The scan reads the project root of an initialized notebook, offline and deterministically, skipping `.git`, `.aimem`, `node_modules`, build output, binary files (a NUL byte) and files over 200 KB. Symlinks are never followed (a clone can link to files outside the repo); each one is listed in `skipped`:
- `adr`: one `decision` per file in `docs/adr/`, `adr/`, `decisions/` (MADR or Nygard); ADR status maps to 03 statuses (unknown → `proposed`); body sections Context, Decision, Consequences (an ADR without those headings keeps its text as the Context).
- `agents`: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/**`: one `memory` per `##` section, verbatim, tags `adopted, imported`, kind `preference` or `howto`; the aimem managed block is ignored; Cursor `globs` become `paths`.
- `readme`: a pinned "Project overview" `memory` from the README intro, plus how-to sections (install, setup, run, test, build, deploy, release, development).
- `docs`: how-to sections from `docs/**` (outside ADR folders).

Candidates whose body looks like a secret are dropped with a warning that names the file and line, never the value. `git`, `prs`, `schema` and `ci` are accepted and warn that they arrive in later slices. `--dry-run` JSON: `data = { dryRun: true, sources[], counts{source: n}, candidates[{source, type, title, summary, status?, kind?, tags, paths?, evidence[]}], skipped[{evidence, reason}] }`.

Without `--dry-run` the candidates are written in priority order (ADRs, agent-instruction sections, overview, how-to sections) through the normal write checks:
- Every record is `trust: inferred` with tag `adopted` and `evidence`, whoever the author is (`--author`, else `AIMEM_AUTHOR`, else git `user.name`); it is never `verified` until a person runs `aimem verify`.
- **Idempotent by evidence:** a candidate whose evidence set is already on a record is not written again. If that record's body differs from the source now, it is listed under "source changed" and left as it is.
- `--max-records` (default 40) limits new records per run; the rest are counted and can be added by running again.
- Not written, with the reason: a pinned overview when the notebook already has one, a draft whose title closely matches a current record that a person or agent wrote (drafts are told apart by evidence, not compared with each other), and anything that fails a write check.
- `write_policy` applies once for the whole run (one commit or `aimem/*` branch, message `aimem: adopt N records`), and embeddings refresh once in the background.

Candidates whose evidence is listed in `.aimem/adopt-discarded` are skipped and counted. JSON: `data = { dryRun: false, sources[], written[{ref, file, type, title, source, evidence[]}], alreadyAdopted, sourceChanged[{ref, evidence[]}], held[{evidence, title, reason}], cut, discarded, skipped[], git }`.

### `aimem adapters`
```
aimem adapters list
aimem adapters add --file <path>        # add a custom target file
aimem adapters sync [--targets ...]     # regenerate the aimem blocks inside AGENTS.md etc.
aimem adapters remove [--targets ...]
```
- Targets: `agents` (AGENTS.md), `claude` (CLAUDE.md), `cursor` (.cursor/rules/aimem.mdc), `copilot` (.github/copilot-instructions.md), `gemini` (GEMINI.md). Default: `adapters.targets` in `project.yaml`, else AGENTS.md plus CLAUDE.md when it exists and does not import `@AGENTS.md`. `--targets` and `add --file` are saved to `project.yaml`.
- `sync` writes only between the markers; a second `sync` changes nothing. `remove` restores files byte for byte and deletes files that held only the aimem block. A broken block (missing marker, two blocks) is reported (`USAGE`, exit 2) and left untouched; other files are still processed. `data.results[] {target, file, action, note?}`; `list` → `data.adapters[] {target, file, state}`.

### `aimem hooks install|uninstall|status`
Keep the generated `INDEX.md` merge-safe (07 §1 rule 5).
- `install` adds an aimem block to the `post-merge`, `post-checkout` and `post-rewrite` hooks. The block runs `aimem index --quiet` when `aimem` is on `PATH`. Other hook content is kept, and the hooks directory comes from `git rev-parse --git-path hooks`, so `core.hooksPath` and worktrees work.
- It also sets `git config merge.ours.driver true`; without it Git ignores `merge=ours`. It adds `.aimem/INDEX.md merge=ours` to `.gitattributes` if missing. Running it again changes nothing.
- `uninstall` removes only the aimem block and deletes hooks that held nothing else.
- `status` reports the installed hooks, the driver and the attribute. `data = { changed?, installed[], mergeDriver, attribute }`.
- `aimem doctor` reports `index merge` as `warn` until all three are in place.

### `aimem hub init`
Turn the current repo into a hub (multi-repo projects): creates `.aimem/` with `scope: hub` and prints the `hub:` snippet to add to each member repo's `project.yaml`.
```
aimem hub init [--project <slug>] [--repos a,b] [--adapters <list>|none] [--force]
```
- Runs the normal `init`, then sets `scope: hub` and, with `--repos`, the `repos:` list. `INDEX.md` shows `scope: hub`.
- The snippet uses the `origin` URL (`data.snippet`); without `origin` it holds a placeholder and warns. Member repos need the same project slug.
- JSON adds `scope`, `repos` and `snippet` to the `init` data.

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
              [--include-superseded] [--no-live] [--session <id>] [--explain]
              [--mode lexical|hybrid] [--deep]
```
Returns the briefing (algorithm in 06 §2). With no args, infers paths from `git diff --name-only` + `git status`, and the task from the current branch name (reported in `data.inferred`).
`--explain` prints why each record was selected and its score (a table after the briefing, not counted in the budget; always present in JSON as `explain`).
`--format json` prints the briefing object; `--json` wraps it in the 04 §7 envelope (the markdown is in `data.markdown`). `--budget` must be ≥ 300. `--mode` defaults to `retrieval.mode` (else `hybrid`); hybrid uses semantic scores when a provider and an up-to-date vector cache exist, otherwise it falls back to lexical, reports the reason in the header (`semanticReason`), and warns only if `--mode hybrid` was given explicitly. In a team notebook with Git sync, `context` fetches `aimem-live` once. It adds a **Live** section (at most 8 claims, then "… N more in aimem live"), warns when the `--ref` task is claimed by another holder or when another holder's active claim overlaps the request's `--paths` or the task's paths, and shows `live claims: N active`, `skipped (--no-live)`, `unavailable` or `off` in the header. JSON adds `live: { status, reason?, claims[] }`, with `mine`, `overlaps`, `shared`, `unsynced` and `expired` on each claim. `overlaps` is set only on other holders' claims (06 §2.2 step 7). A fetch failure never fails the briefing: it adds a warning, and the Live section says "Not checked: team claims are unavailable." instead of "No active claims.", followed by any unsynced local claims. Afterwards, `context` extends this session's own active claims (`--session`, else `AIMEM_SESSION`) whose heartbeat is at least 20 minutes old, or half the claim's TTL when that is shorter. `--no-live` skips the fetch and the heartbeat. `--deep` is reserved and ignored with a warning (OQ-30).

Local hybrid `context` can match a confident corpus word as another scoring view
(15 §7), using the existing embedding model. Run `aimem index --embeddings` after
upgrading to build the version-2 vocabulary cache. This is deterministic local
retrieval; optional LLM rewriting and cross-encoder ranking remain disabled by
default. Search and ask continue to use their existing ranking paths.

### `aimem search <query>`

```
aimem search "<query>" [--type decision,memory] [--status ...] [--tag ...] [--role ...]
                       [--repo ...] [--paths <glob>] [--limit 10] [--include-superseded]
                       [--mode lexical|hybrid]
```
`--mode` works as for `context`; `data.mode` reports what was actually used, with `semanticModel`/`semanticCoverage` or `semanticReason`. By default hides records that are `superseded`, `rejected`, `cancelled`, `done` or `retired` (as `context` does, 06 §2); `--include-superseded` shows them, and an explicit `--status` shows the listed statuses.
Search multiplies handoff relevance by 0.5 after lexical/hybrid fusion, before
limiting and normalizing scores, to favor direct durable answers over session
summaries. Explicit history terms (`handoff`, `session`, `history`, `sesi`,
`riwayat`, their supported plurals, `what happened`, `experiment results`) retain
the original relevance. `--type handoff` preserves handoff ordering. This also
affects the search candidates used by `ask`; context scoring is unchanged.
`context`, `search` and `ask` honor optional `retrieval.query_rewrite: llm` and
`retrieval.rerank: cross-encoder` (15 §7/§9). Both default to `none`. Rewriting
sends only explicit user query/task text, never task-record bodies or derived tags,
and requires `retrieval.llm.allow_remote: true`. Search fuses the original and
reformulations with RRF; context keeps each record's best complete score across
queries. Local ranking follows fusion and retains trust/freshness policy.
Provider failure or invalid output warns and preserves the preceding retrieval
result. JSON envelopes are unchanged; local inference adds `rerank.local` call
metadata to the existing cache log without question/document text.

### `aimem usage record --session <id> --refs <ref,...>`

Explicitly report cited/used refs to the local cache (15 §18); returning a briefing
does not automatically count as use. Provide an opaque session ID and 1–100 refs.
Unknown/foreign refs fail with `NOT_FOUND` (exit 1); invalid sessions, ref syntax or
arguments use `USAGE` (exit 2); inaccessible append storage uses `PERMISSION_DENIED`
(exit 2) without raw filesystem details. All validation precedes writing.
Success exits 0; `--json` data is `{recorded: true, file, entry}` where `file` is
`.aimem/.cache/usage.jsonl` and `entry` follows 15 §18. No commits, record/index
updates, model calls or learned weights. Cache history may be deleted to clear it.

### `aimem ask "<question>"`
Retrieval-augmented answer with citations (15 §10).

Optional `retrieval.rerank: llm` uses the configured, consent-enabled LLM to rank
up to 50 eligible records before answering (15 §9). It is off by default. The extra
request has a 64,000-character prompt cap and the same per-call timeout and local
metadata logging as answer generation. Invalid rankings, provider failures or
`--limit` above 50 warn and retain the original selection; JSON fields are unchanged.
`context --deep` is still reserved.

**Optional local ranker setup:**

`aimem index --reranker` explicitly downloads/caches the optional multilingual
cross-encoder under `$AIMEM_HOME/models` (default `~/.cache/aimem/models`).
It does not enable ranking: set `retrieval.rerank: cross-encoder` to opt in.
`index --json` adds `data.reranker {available, provider? , reason?}` only with
`--reranker`; unavailable setup warns, exits 0, and leaves original retrieval usable.
Ordinary retrieval and doctor never download models.
```
aimem ask "why did we choose postgres for the ledger?" [--role pm] [--limit 8] [--mode lexical|hybrid] [--json]
```
Requires `retrieval.llm` to be configured; otherwise fails with `LLM_FAILED` (exit 4) and a message saying how to enable it. Answers only from retrieved records, cites every claim as `[ref]`, says "not found in the notebook" when evidence is weak, and reports how many sources were `verified` / `agent` / `inferred`. `--role` ranks that role's records higher but never filters (09 §5). Notebook records are read-only; local call metadata is appended to `.aimem/.cache/calls.jsonl` (15 §17). The model gets no tools.

`--json` data (contract): `question`, `answer`, `found` (false when nothing matched or the model said not found; exit 0 either way), `sources[] {ref, type, title, trust, verified?}` (cited records only, in citation order), `confidence {verified, agent, inferred, note}`, `retrieval {mode, semanticModel+semanticCoverage | semanticReason, considered, excluded[] {ref, reason}}`, `provider`. Citations of records that were not retrieved are dropped and reported in `warnings`.

### `aimem show <ref>`
Print one record (`--raw` for file text, `--links` to expand linked summaries). In a multi-repo project, a ref resolves through the hub and sibling notebooks too (03 §7); JSON adds `notebook` for records from them, the human header names that notebook before the file path (`hub: .aimem/…`), and `NOT_FOUND` names any source that could not be read.
### `aimem list [type]`
Table of records with filters (`--status`, `--stale`, `--trust inferred`, `--mine`). When hub or sibling records are listed, the human table adds a `SOURCE` column (`local`, `hub`, `repo:<name>`); JSON records carry `notebook` as in `show`.
### `aimem status`
Project overview: counts, open p0/p1 tasks, live claims, stale items, unreviewed agent records. `--json` data: `project, mode, sync, total, counts, urgentTasks, stale, unreviewed {agent, inferred}, problems, lastHandoff, claims`. In a team notebook with Git sync, `claims` is `{ status, reason?, active, expired, unsynced, mine[] }`, where `status` is `on`, `skipped` (`--no-live`) or `unavailable` (the fetch failed, with a warning); otherwise it is `null`. In a multi-repo project, `sources` lists each notebook as `{ name, kind, status, records | reason }` and missing sources and duplicate IDs are warnings.
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
- Runs a **dedupe check**: a current record of the same type whose title is very similar (word overlap ≥ 70%) or whose title + summary overlap ≥ 50% is a likely duplicate; it is named in `error.details` and the command exits 3 unless `--force`. In a multi-repo project the hub and sibling notebooks are checked too (03 §7); a match there adds `details.notebook` and says where it is. New IDs are also kept unique against those notebooks (agents should then `aimem show` it and update/supersede instead).
- Sets `trust: agent` for `agent:*` authors, `verified` for `human:*`. When `write_policy.durable_requires_review` applies (default in team mode), a human's `decision`, `runbook` or `schema` also starts as `trust: agent` with a warning, and `aimem verify` by its own author returns `PERMISSION_DENIED`; another human verifies it. Authors are self-declared (`--author`, `AIMEM_AUTHOR`, git `user.name`), so this is a workflow guard, not access control: a process that claims another `human:` name passes it (09 §5). Use branch protection and review for hard guarantees.
- Applies `write_policy.agent_commits` (`none|stage|commit|pr`; default `commit` in solo mode, `stage` otherwise) to **agent** writes only; human writes are left for the human to commit. Only the files the command wrote are staged/committed (`git commit --only`), so other staged work is never included. Commit message `aimem: <verb> <ref> <title>` plus a trailer `Aimem-Author: <author>`. `pr` commits only the written files to a new branch `aimem/<ref>` (or `aimem/<ref>-2`, …) from `HEAD` through a scratch index, so the current branch and the git index are unchanged. The written record files and the regenerated `INDEX.md` still stay in the working tree (untracked/modified): check `git status` before `git add -A`, or they are committed on the current branch too; `data.git` is `branched` and a warning names the branch to push. Without any commit yet it stages and warns. The branch commit includes the regenerated `INDEX.md`, so several `aimem/*` branches touch it; with `aimem hooks install` (the `merge.ours` driver) they merge without conflicts and the hook regenerates it. Outside a git repo, without git, or when git refuses (e.g. a failing hook) the records stay written, a warning is added, and the exit code is 0. Write commands report `data.git`: `none | staged | committed | skipped | failed`.
- A commit policy stages and warns for agents on guarded/default branches or an
  unidentifiable current branch (03 §6). This deliberately changes main-branch
  `data.git` from `committed` to `staged`; JSON field names and exit codes stay
  unchanged. Only local git metadata is consulted, with no network fetch.

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
Move a record between the hub and a repo, preserving its ID and leaving a pointer stub (`status` unchanged, body replaced by an `aimem show <project>:<id>` hint) in the old place. Reads resolve to the moved record, and `validate --project` never reports the stub as a duplicate; nothing removes it automatically.
- Run it in the notebook that holds the record. `--to` is `hub` or a name from `repos:`. The target must be checked out (03 §7); an unknown, missing or unreadable target returns `USAGE`, and a target that already has the ID returns `INVALID_RECORD`.
- The target gets the file unchanged at the same path; the stub gets `moved_to: hub|repo:<name>` and a new `updated`. Both notebooks regenerate `INDEX.md` and follow their own `write_policy`.
- Reads prefer the moved record over the stub. Moving a stub again returns `USAGE`. Externally-owned records return `READONLY_EXTERNAL`.
- JSON: `data = { ref, to, changed[], git, target: { changed[], git } }`.
### `aimem review`
Interactive queue over records that need human attention: `trust: inferred`, unreviewed `trust: agent`, stale, possible duplicates. Per item: verify · edit+verify · skip · discard.

Status (22 §4.5): the queue holds local `inferred` records first, then unreviewed `agent` records, then stale ones (retired records and handoffs never need review; possible duplicates are not listed yet). On a terminal, each item shows its ref, type, status, trust, title, file, evidence and summary, then asks `(v)erify (e)dit+verify (s)kip (d)iscard (q)uit`; `e` opens `$VISUAL`/`$EDITOR` (arguments such as `code --wait` are allowed; no shell is used) and verifies after it closes; if the editor fails, or leaves an invalid record, nothing is verified and the item counts as skipped. Verifying and discarding are human-only: for an agent they are refused with a message and the item counts as skipped. With `--json`, or without a terminal, it only lists the queue: `data = { queue[{ref, type, status, trust, title, summary, file, author, created, evidence?, reasons[]}], counts{inferred, unreviewed, stale} }`.
### `aimem discard <ref>`
Delete a record. Allowed **only** if it was never `verified` and nothing links to it (ADR-007 exception). Humans only (`PERMISSION_DENIED` for agents and for verified records; `INVALID_RECORD` when another record links to it or supersedes it). Also refused for a `move` pointer stub (`INVALID_RECORD`), for externally-owned records (`READONLY_EXTERNAL`), and when a hub or sibling notebook links to it. The file is deleted and `INDEX.md` regenerated; commit the deletion yourself (it stays recoverable from Git). When the record was an adopted draft, its evidence is added to `.aimem/adopt-discarded` (tracked, one line per draft, `#` comments) so `aimem adopt` does not write it again; delete the line to adopt it again. JSON: `data = { ref, file, changed[], git }`. Everything else is superseded.

### `aimem handoff`
```
aimem handoff [--task <ref>] --done "..." --not-done "..." --next "..." [--blocked "..."] [--notes "..."]
              [--from-file <path>] [--release-claims | --no-release-claims] [--session <id>] [--commit]
```
Writes a `handoff` record, releases this session's claims (default), updates `INDEX.md`.
- `--done`, `--not-done`, `--next` are required (from flags or `--from-file`, a markdown file with `## Done` / `## Not done` / `## Next` / `## Blocked` / `## Notes for next agent`; flags win). `--blocked` and `--notes` default to `none`.
- Title `Handoff <date>: <first line of Done>` (≤ 120), summary `Done: … · Next: …` (≤ 200, cut with `…`), `branch` from git, `--task` must be an existing task.
- Applies `write_policy` like other writes; `--commit` requests a commit regardless
  of policy, but an agent still cannot commit on a guarded/default branch (03 §6).
  Explicit human commits remain supported there.
- **Claims (team notebooks with Git sync).** The record is written first; releasing claims never undoes it. Then `handoff` releases every live claim owned by this holder and session (`--session`, else `AIMEM_SESSION`): exclusive and path-only claims are released, shared claims are left, and this session's unsynced local claims are discarded. `--no-release-claims` keeps them. JSON adds `claimsReleased` (a count) and `claims: { status, checkedAt, released[], kept[{ref, reason}], related[{ref, holders, paths?}] }`. `kept` lists the caller's claims still held (another session, no session given, or a failed release), each with a warning that names the release command. `related` lists other holders' active claims on the `--task` or overlapping its paths. If the remote is unavailable, the handoff still succeeds with a warning that claims may still be active. Human output lists released, still held and related claims and when they were checked. Solo notebooks report `claimsReleased: 0` and no `claims`.

## 5. Task and claim commands

```
aimem task claim [<ref>] [--author <who>] [--session <id>]
                        [--paths <globs>] [--note <text>] [--ttl <minutes>m] [--steal] [--share] [--local]
aimem task heartbeat <ref> [--author <who>] [--session <id>]
aimem task release <ref> [--author <who>] [--session <id>]
aimem live [--offline]
```

- Exclusive claims require an online Git-backed team notebook and a task in its local records. Use either the task ID or its project-qualified ref. The TTL comes from `claims.ttl_minutes` (default 180) unless overridden.
- Session precedence is `--session`, `AIMEM_SESSION`, then a random ID generated for this invocation. Supply an opaque 1–64 character ID beginning with a letter or digit and containing only letters, digits, underscores or hyphens. Reuse it across invocations for the same session.
- Claim success prints the session or returns `data.claim` and `data.overlaps` in the `task claim` JSON envelope. An identical holder and session gets an active claim back. An occupied path, expired heartbeat, premature takeover or changed target during a retry can return `CLAIM_CONFLICT` (exit 3, `details.holder` and `details.since`). An uncertain Git failure returns `SYNC_FAILED` (exit 4).
- `--note` is cleaned before it is stored: control characters (such as ANSI escapes and newlines) become spaces, and a note longer than 500 characters returns `USAGE`. Notes read from `aimem-live` are cleaned and cut to 500 characters before they are shown or returned, because other clients may have written them.
- A task claim without `--paths` copies the task record's `paths`, so overlap warnings cover task claims.
- `--paths` accepts up to 32 comma-separated, repo-relative globs of at most 256 characters each. Backslashes become `/` and duplicates are removed. Absolute paths, drive letters, empty, `.` or `..` segments and control characters return `USAGE` before any Git call. Explicit claim metadata goes to the live branch, where repository readers can see it. The CLI checks it for likely secrets before contacting Git.
- Without `<ref>`, `--paths` creates a **path-only claim** for ad-hoc work. Its ID is `clm-` plus eight ID characters, returned as `data.claim.id` instead of `task`. Pass that ID to `task heartbeat`, `task release` and `task claim --steal`. A takeover without `--paths` keeps the abandoned claim's paths. An unknown `clm-` ID returns `NOT_FOUND`.
- `--share` creates a **shared (pairing) claim** on a task, or joins an active one. The claim gains `shared: true` and `participants: [{ holder, session, joined, heartbeat }]`, with at most 8 participants. Top-level `holder` and `session` name the first participant, and `heartbeat` is the latest participant heartbeat. `--share` against an exclusive claim, or a claim without `--share` against a shared one, returns `CLAIM_CONFLICT`. `--share` requires a task ref. Every teammate must run a CLI with shared-claim support before using `--share`. Older CLIs drop `participants` when they rewrite the claim.
- In a shared claim, `task heartbeat` extends only the caller's entry, and an expired participant cannot heartbeat. A join drops expired participants. `task release` removes only the caller, and the last one deletes the claim. Release by a session that is not a participant returns `released: false`. `--steal` works only when every participant has expired and the five-minute allowance has passed. The takeover commit records each previous holder.
- **Overlap warns and never blocks** (07 §2.1). After a claim, `data.overlaps` lists active claims by other holders whose paths overlap, as `{ ref, holder, paths }`, and each overlap adds a warning. Overlap compares the static segments before the first wildcard segment, so it may report false positives. Claiming a task that is `done` or `cancelled` in the local checkout also adds a warning.
- `task heartbeat` and `task release` require the existing session ID via `--session` or `AIMEM_SESSION`. Heartbeat extends an active claim and returns `data.claim`. Release removes an owned claim even after expiry or after its durable task file has been removed. It returns `data.released`, which is false if the claim was already absent when the command started.
- `--steal` replaces an expired claim once its five-minute clock-skew allowance has passed. The same rule applies to all callers. The takeover commit records the previous holder. A missing claim returns `NOT_FOUND`.
- `live` fetches a snapshot and lists task claims in task-ref order, then path-only claims by ID. Human output is a table of ref (without the current project prefix), task title, holders with "(you)" for the current author, paths, age, time to expiry and a status word (`active`, `possibly abandoned`, `shared · N participants`, `unsynced`); exact times stay in JSON. JSON returns `data.claims` with `expired` and `expiresAt` on each entry. Human output marks expired claims as “possibly abandoned.” A malformed live entry is skipped with a warning naming its path. A claim operation on that same entry still returns `SYNC_FAILED`.

Batch heartbeat, release with a durable status change, and streaming live updates are planned.

```
aimem task create --title "..." [--priority p1] [--assignee rina] [--roles dev,qa] [--paths ...]
aimem task list [--status open] [--mine] [--claimed]
aimem task status <ref> <status>
```
- `--local` saves an **unsynced local claim** when the remote is unreachable (`SYNC_FAILED`) or with `--offline`. It is stored in `.aimem/.cache/claims-pending/<id>.json` and returned with `data.claim.unsynced: true` and a warning. It cannot be combined with `--steal` or `--share`. Before every online `task claim`, `task heartbeat`, `task release` and `live`, saved claims are published through the normal compare-and-swap, keeping their local `started` time with `heartbeat` set to the sync time. A claim that lost to an earlier live claim, expired before syncing, or no longer resolves is dropped with a warning naming the live holder. A sync failure keeps it for the next attempt. `live --offline` lists only unsynced local claims, marked `unsynced`.

## 6. Maintenance commands

| Command | Purpose |
|---------|---------|
| `aimem validate [--strict] [--fix] [--project]` | Run rules V001–V018 (03 §9). `--fix` first repairs safe issues — renames files that do not start with `<id>-` (V015; never overwrites), adds the missing half of a one-sided supersede link (V007), raises `updated` that is earlier than `created`, rewrites `\` to `/` in `project.yaml` `adapters.files` (03 §10; reported with code `paths`) — and reports them in `data.fixed` / `data.skipped`; it never deletes or resolves conflicts. `--project` also checks project-qualified refs against the hub and sibling notebooks (V006) and reports IDs that exist in more than one notebook (V005); notebooks that could not be read are listed in `unchecked` and refs only they could resolve are not reported |
| `aimem index [--embeddings] [--rebuild]` | Regenerate `INDEX.md`; rebuild the lexical index and (re)compute embeddings; `--rebuild` discards the cache first. The only command that downloads the local model (prints name and size first, to `$AIMEM_HOME/models`). For `openai-compatible`, the key comes from `AIMEM_EMBEDDINGS_KEY`. `data.embeddings` reports `{available: false, reason}` (exit 0, warning) or `{available: true, provider, chunks, built, reused, removed, rebuilt, reason?, excluded[]}` |
| `aimem stale [--mark]` | List stale records; `--mark` sets memory status to `stale` |
| `aimem doctor` | Diagnose environment: git, remote access, server reachability, adapter presence, schema version, embedding provider/model status, and exactly what content would leave the machine. Read-only, no network; each check is `ok`/`warn`/`info` in `data.checks`; always exits 0 (use `validate --strict` as the CI gate) |
| `aimem sync [--compact]` | Fetch durable state, push/pull live branch, or reconcile with server. `--compact` (maintainers) recreates `aimem-live` from its current tree to drop heartbeat history |
| `aimem migrate` | Upgrade files to the current spec major |
| `aimem export [--format html\|json\|md]` | Static export of the whole notebook (backup / read-only sharing) |

`doctor` includes an informational `call log` entry describing `.aimem/.cache/calls.jsonl`
and its metadata-only policy (15 §17). This adds a check to `data.checks`; the JSON envelope
and exit codes remain unchanged.
| `aimem config get\|set\|list` | Edit `project.yaml` safely |
| `aimem serve mcp [--http <port>]` | Start the MCP server (05). v0.1: stdio only; stdout carries the protocol, so nothing else is printed |
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
| | | `LLM_FAILED` (LLM provider missing, not logged in, timed out or failed; ADR-017) | 4 |

`aimem validate`: with errors it fails with `INVALID_RECORD` and `error.details = {errors, warnings, issues, unchecked?}` (exit 2); otherwise `ok: true` with the same `data`, exit 1 under `--strict` if there are warnings, else 0.

### Development-build freshness

In a recognized aimem source checkout, `doctor` compares TypeScript files in the
CLI and its runtime workspace packages against corresponding built JS files.
Missing or older output produces a `development build` warning suggesting
`pnpm build`. The check inspects the running binary's checkout, even when the
selected notebook is elsewhere. Published installs skip it. Unavailable metadata
is informational; doctor still exits 0. This is a modification-time heuristic,
not a content hash. The JSON envelope is unchanged; `checks[]` gains this entry
only for recognized development builds.

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
