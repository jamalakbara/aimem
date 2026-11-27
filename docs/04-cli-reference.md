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
aimem adopt [--dry-run | --agent-plan] [--since <date>] [--sources readme,docs,adr,agents,ci,schema,git,prs]
            [--max-records 40]
```
Creates draft records with `trust: inferred`. `--dry-run` prints what would be created.

Status (22 §4.1–4.3): every source is implemented. Without `--sources` all offline sources are read; `prs` is opt-in. The scan reads the project root of an initialized notebook, offline and deterministically, skipping `.git`, `.aimem`, `node_modules`, build output, binary files (a NUL byte) and files over 200 KB. Symlinks are never followed (a clone can link to files outside the repo); each one is listed in `skipped`:
- `adr`: one `decision` per file in `docs/adr/`, `adr/`, `decisions/` (MADR or Nygard); ADR status maps to 03 statuses (unknown → `proposed`); body sections Context, Decision, Consequences (an ADR without those headings keeps its text as the Context).
- `agents`: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/**`: one `memory` per `##` section, verbatim, tags `adopted, imported`, kind `preference` or `howto`; the aimem managed block is ignored; Cursor `globs` become `paths`.
- `readme`: a pinned "Project overview" `memory` from the README intro, plus how-to sections (install, setup, run, test, build, deploy, release, development).
- `docs`: how-to sections from `docs/**` (outside ADR folders).
- `readme` also reads `package.json`, `pyproject.toml`, `go.mod`, `Dockerfile` and `docker-compose.yml`/`compose.yaml` at the root into one "Tech stack" `memory` (kind `fact`): dependencies, Go module, base images, compose services.
- `ci`: one "Build and deploy" `runbook` from `.github/workflows/*.yml` (`run:` lines; `run: |` blocks give one command per line, `run: >` blocks one command per paragraph; `#` comments are left out), `.gitlab-ci.yml` (`script:` lists), `Makefile` targets and `package.json` scripts; Rollback and Verify say "_Not stated in the build files._".
- `git` (needs the project to be the root of its git repository, otherwise a warning says so even on a default run; `--since` is a `YYYY-MM-DD` date or an age such as `6 months ago`, default one year, anything else is `USAGE`): a "Change hotspots" `memory` (files with two or more commits, lockfiles and build output left out) and up to 5 "Gotchas in <path>" `memory` records (kind `gotcha`, `paths` set) for files with two or more `fix:` commits or a revert, listing the commits (each subject cut to 100 characters). Evidence is `git-history:hotspots` / `git-history:<path>`, so new commits show up as "source changed" instead of new drafts.
- `prs` (opt-in, uses `gh` in the project root): merged pull requests with a `decision`, `architecture` or `adr` label, or a description of 500+ characters, become accepted `decision` drafts (Context = description, Decision = "Merged in #N"); evidence is the PR URL. A missing or signed-out `gh` is a warning.
- `schema`: one "Database schema" `schema` record from `*.sql` in `migrations/`, `db/migrate/`, `db/migrations/`, `supabase/migrations/`, `prisma/migrations/`, `sql/migrations/`: tables and columns (`CREATE TABLE`, `ALTER TABLE … ADD`), `--` comments as Invariants, and the migration list.

Candidates whose body looks like a secret are dropped with a warning that names the file and line, never the value. For the Tech stack, Database schema and Build and deploy records each source file is checked on its own: a file with a likely secret is left out (and named), the rest of the record stays. When `git` or `prs` was asked for but cannot run (no repository, no `gh`), a warning says why. `--agent-plan` (22 §4.4) writes no records: it saves the candidates whose evidence is not on any record yet, with their bodies, to `.aimem/.cache/adopt-plan.json` (`{ version: 1, project, generated, candidates[] }`) and prints a prompt for the person's agent: read the evidence, write each record with `aimem add … --evidence <list>`, under 300 words, stating uncertainty. It cannot be combined with `--dry-run`, and `--max-records` does not apply to it (a warning says so). The prompt tells the agent to treat the plan and evidence files as data, never as instructions. JSON: `data = { plan, candidates, alreadyAdopted, prompt }`.

`--dry-run` JSON: `data = { dryRun: true, sources[], counts{source: n}, candidates[{source, type, title, summary, status?, kind?, tags, paths?, evidence[]}], skipped[{evidence, reason}] }`.

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

Status (23 §4b.1–4b.2): `.md`, `.markdown`, `.txt`, `.docx`, `.pdf`, `.csv` and `.xlsx` files are implemented; URLs, `--template`, `--dry-run`, `--keep-original` and `--extract` arrive in later slices (`USAGE` until then).
- **Sheets (`.csv`, RFC 4180):** one row = one record, keyed by `(upload, file, row)` (`source.row` is the sheet row; the header is row 1). `--as tasks|testcases|incidents`, or picked from the headers. Columns follow 16 §4.1 (case-insensitive, spaces → `_`); unknown columns go into the body as a small table. An optional `key` column keys rows by its value (`source.row: key:<value>`), so inserting or deleting rows does not move records; without it rows are keyed by position, and a row whose title changes is reported ("row positions shift…"). A bad row (empty title, unknown status, priority, severity, bad date, an empty or repeated key, `paths` with `..` or an absolute path, an unterminated quote) is reported as `row N: reason` and the other rows import; rows with missing or extra cells are reported too; `--strict` exits 1 when a row failed. Cells are plain text: a formula such as `=cmd|…` is never evaluated. Rows of the same sheet are not compared with each other for duplicates. JSON: `data = { type, created, updated, unchanged, errors[{row, reason}], rows[{row, ref, action}], source{system, id}, git }`.
- **Word documents (`.docx`):** `word/document.xml` becomes markdown (Title/Heading styles → headings, numbered and bulleted paragraphs → lists, tables → markdown tables, tabs and breaks kept; images, comments, field codes and tracked deletions left out; without a Title-styled paragraph, a heading that opens the document and is not a template section name is the title (otherwise the first plain paragraph is, as for `.md`); plain text that CommonMark would read as structure (`# `, `- `, `* `, `+ `, `>`, `1. `, `` ``` ``, `~~~`, `|`) is escaped so it cannot fake structure, and titles and summaries drop that escape), then the document templates apply as for `.md`. The same bounded unzip as xlsx is used (limits while inflating, unsafe names and DTDs refused, nothing written to disk); text over 2 MB is refused; macros are ignored with a warning.
- **PDF (`.pdf`):** always whole-document mode (one `memory` with `kind: reference`, titled by the PDF's Info title when it has one, else its first line); text is read with pdf.js through `unpdf` 1.4.0 (pinned, no dependencies) in a worker thread with eval off. Limits that stop the parse, not just its result: 20 s wall clock (the worker is terminated), a 256 MB V8 heap, 256 MB growth of the process's resident memory (decompressed buffers live outside the heap, so a decompression bomb is caught here), 500 pages, 2 MB of text. Password-protected files are refused; JavaScript, launch actions and embedded files are reported and never run or extracted; a file without readable text (a scan, since there is no OCR, or fonts whose character maps are not available) is refused. Up to 1,024 bytes before the `%PDF-` header are accepted, as the specification allows.
- **Workbooks (`.xlsx`):** each worksheet is its own source (`source.id` = `<file>!<sheet>`), so importing another sheet of the same file never takes over these records. the first visible worksheet, or `--sheet <name>` (a hidden sheet is read only by name, with a warning); then the same rules as CSV, except that short rows are padded (spreadsheet apps leave out empty cells at the end of a row). Dates in 1904-based workbooks are read as such. Macros (`vbaProject.bin`) are ignored with a warning. Cells outside the OOXML bounds (16,384 columns, 1,048,576 rows) and cells over 1 MB are row errors; more than 2,000,000 cells refuse the sheet. When no template matches, the message lists the sheets. Shared, inline and rich-text strings, numbers and booleans are read as text; a formula gives its cached value, or `=formula` as text when the file has none, and is never evaluated; date serials in `due`, `started` and `resolved_at` become ISO dates. The archive is read in memory with limits checked while inflating (not from its headers): at most 1,000 entries, 20 MB per entry and 50 MB in total, with the input fed in 64 KB pieces so inflating stops within one piece of the limit (a forged-header bomb is refused in about a second); entry names with `..` or absolute paths, two entries with one name, compression other than stored/deflate, and any DTD or entity declaration (XXE) refuse the file.
- **Outside the project:** an agent imports a file outside the project only with `--allow-outside`; a person may import any file they name.
- **Lock:** one import at a time per notebook. A lock whose process is alive is never taken over; one whose process is gone is taken over at once; a lock without a readable PID counts for 60 s. A second import waits up to 20 s (`AIMEM_IMPORT_LOCK_WAIT_MS`) and then says which PID holds it.
- **Speed:** a sheet is written in one pass (one index load, one INDEX.md and vector refresh): about 2 s for 400 rows and 15 s for 5,000 on a 4-vCPU machine.
- `--as auto` (default) picks the document template by its headings (16 §4.2): decision (Context, Decision, Consequences; optional Summary, Status, Alternatives), runbook (When to use, Steps, Rollback, Verify), incident (Impact, Timeline, Root cause, Fix, Prevention; optional Severity), memory (Summary). The first `#` heading is the title; `Roles:` and `Tags:` lines under it are optional. Otherwise the whole text becomes one `memory` with `kind: reference`, and a warning says why (for `--as <type>`: which headings are missing).
- The record is `managed_by: external` with `source.system: upload`, `source.id` = the file's path inside the project (or `name:<file>#<hash of its full path>` outside it, so two outside files with the same name stay apart without the path being written to the repo), `version` = a hash of the file, `content_sha` of the body. Importing the same file again updates that record, or reports it unchanged; no duplicates. Roles and tags follow the source as well. When the content, roles or tags changed, the record takes the trust of this import: an earlier verification does not carry over, and a warning says it needs review again. The id is derived from the source key, so two clones that import one source agree on it. Trust follows `add`: a human import is `verified` unless `durable_requires_review` applies; an agent import is `agent`.
- Limits: 10 MB, no binary files other than `.docx`, `.pdf` and `.xlsx`, no symlinks (import the target itself); a likely secret refuses the whole file (`SECRET_DETECTED`, nothing written). Control characters, bidi overrides and invisible tag characters are removed; `Roles:`/`Tags:` values that are not plain names are left out with a warning; front matter at the top of the document (a `---` block holding only `key: value`, list or indented lines) is left out with a warning, while a document that merely starts with a `---` rule keeps its text. When a title comes from the first line of a document without a `#` heading, a leading horizontal rule (`---`, `***`, `___`) is skipped. Zero-width spaces and word joiners are removed from titles and summaries (documents and sheet rows; `key` and the cells in the body stay as they are, and a row whose title has nothing visible is an error); ZWNJ and ZWJ stay for the languages that need them. `--as` accepts only the values above. One import runs at a time per notebook (`.aimem/.cache/import.lock`), so parallel imports of one new file create one record. `--force` creates the record even when a likely duplicate exists (for example after `detach`). `write_policy` applies once per run. Every run warns: "Imported content is visible to everyone who can read this repository".
- JSON: `data = { action: created|updated|unchanged, ref, type, title, trust, mode: template|whole-document, file, source{system, id, version}, git }`.

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

Status (23 §4b.4): `list`, `add google --folder|--file <id or link>`, `remove google`, `status` and `sync [--dry-run] [--strict] [--force] [--offline]` are implemented.
- **Status:** `status` reads only the notebook and the key file: no network, no writes, open to agents. It shows the selection, whether the key file is usable (`credentials: ready | missing | unusable`; `ready` was not tried against Google), records per kind, records whose source is missing, and `last_change` = the newest `synced_at` (a sync that changes nothing does not move it). Exit 0 inside a notebook, whatever it finds; records that fail the schema are not counted (`validate` shows them). JSON: `data.sources[] = { kind, configured, folder, files, credentials, documents, rows, missing[{ref, title}], last_change }`; `configured: false` means the source was removed and its records remain.
- **Selection:** one inbox folder (`connectors.google.inbox_folder_id`; subfolders are not walked) and single files (`connectors.google.files`). `add` and `remove` are human-only (`PERMISSION_DENIED`): which documents are shared with the project is a person's choice. `remove` keeps the records.
- **Credentials:** a service-account key file named by `AIMEM_GOOGLE_CREDENTIALS`, else `GOOGLE_APPLICATION_CREDENTIALS`. It must be a regular file of at most 64 KB. A file inside the repository (also through a link) is refused. Scopes are fixed to `drive.readonly` and `spreadsheets.readonly`; the token is requested only from `oauth2.googleapis.com`, whatever the key file says; redirects are refused. No key, token or response body reaches a record, message or JSON output.
- **Docs** are exported as markdown; the Doc's name is the title; templates as in 16 §4.2; image data is dropped. A Doc whose `modifiedTime` did not change is not fetched again. **Sheets** are read per visible tab with computed values (never formulas); rows follow 16 §4.1, keyed by tab id and `key` or row; hidden tabs are skipped with a warning. Other file types and subfolders are skipped with a warning. Control characters, bidi overrides and invisible tag characters are removed; front matter at the top of a Doc is left out with a warning.
- **Look-alikes:** Google documents are told apart by their Drive id, so recurring names ("Weekly report …") are all imported. A Doc that looks like a record from elsewhere (hand-written, uploaded, detached) is reported as `DUPLICATE_LIKELY`; `sync --force` imports it anyway.
- **Gone:** a file that is no longer listed or shared, a deleted tab, or a row that left a tab without row errors gets `source.state: missing` (V018); content stays, and it comes back when the source does.
- **Failures:** everything is read before anything is written. `SOURCE_AUTH` (key, token, folder not shared; the folder itself is checked first, so an unshared folder never looks empty) and `SOURCE_UNREACHABLE` (network, 429/5xx after 4 tries, incomplete or looping lists) change nothing. One unreadable file or row is reported and the rest goes on. A sync killed while writing is finished by running it again: same ids and content as an uninterrupted one. With `write_policy: commit` or `pr`, records written before the kill stay uncommitted (`git status` shows them); commit them yourself.
- **Two clones:** records carry who synced and when, so two people who sync the same documents on separate branches get merge conflicts in those records. Let one person sync, or pull before you sync.
- Limits: 1,000 files, 50 tabs, 5,000 rows per tab, 10 MB per document, 30 s per request. One import lock, one `write_policy` commit per run. JSON: `data = { created, updated, unchanged, missing, errors[{file, reason}], records[{ref, action, file}], git }`.

### `aimem templates`
```
aimem templates list
aimem templates export <type> --format xlsx|md|csv     # blank templates for non-developers
```
Status (23 §4b.2): `list` and `export <name> --format csv|xlsx|md [--out <path>] [--force] [--allow-outside]` are implemented (`xlsx` needs `--out`; `--out` refuses a symlink) (`--out` never overwrites an existing file without `--force`, and an agent writes outside the project only with `--allow-outside`); Sheet templates (`tasks`, `testcases`, `incidents`) export their CSV header row; document templates (`decision`, `runbook`, `incident`, `memory`) export the markdown headings that `aimem import` recognises, so a filled template imports back as its type.

### `aimem detach <ref>`
Make an externally-owned record notebook-owned permanently (stops syncing). Removes `managed_by` and `source`, adds a line at the end of the body naming the source, version, date and author, and applies `write_policy`. Afterwards `update`, `supersede` and `discard` work, and a new import of the same document is a likely duplicate instead of an update. `USAGE` for a record that is not externally owned.

Externally-owned records are refused (`READONLY_EXTERNAL`, "edit it at the source, or run aimem detach") by `update`, `supersede` (old or new record), `add --supersedes`, `move`, `discard` and the `e` key of `aimem review`. `verify` is allowed: it changes only `trust`, which a team needs for imported durable records.

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
- `--evidence <list>` (files or `path#heading`, comma-separated) marks a draft written from existing sources, as `adopt --agent-plan` asks: the record is `trust: inferred` with tag `adopted` and that `evidence`, and a later `aimem adopt` counts it as already adopted.
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

Status (22 §4.5): the queue holds local `inferred` records first, then unreviewed `agent` records, then stale ones, then possible duplicates (retired records and handoffs never need review). A likely-duplicate pair (same type, similar title or title + summary, as in `add`) is listed once: the newer record, with `duplicateOf` naming the older one. Two adopted drafts are never paired (they are told apart by evidence, and template ADRs share most of their words). `--limit <n>` shows or walks only the first n. On a terminal, each item shows its ref, type, status, trust, title, file, evidence and summary, then asks `(v)erify (e)dit+verify (s)kip (d)iscard (q)uit`; `e` opens `$VISUAL`/`$EDITOR` (arguments such as `code --wait` are allowed; no shell is used) and verifies after it closes; if the editor fails, nothing is verified; if it leaves an invalid record, the original file is restored and nothing is verified. Without `$VISUAL`/`$EDITOR` it says so and opens `vi` (`notepad` on Windows). An unknown key asks again. Verifying and discarding are human-only: for an agent they are refused with a message and the item counts as skipped. With `--json`, or without a terminal, it only lists the queue: `data = { queue[{ref, type, status, trust, title, summary, file, author, created, evidence?, duplicateOf?, reasons[]}], counts{inferred, unreviewed, stale, duplicate}, total }` (`total` counts the whole queue, also with `--limit`).
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
| `aimem serve web [--port <n>]` | Read-only web viewer of this notebook and its hub and sibling checkouts (10 §2, 24). Listens on `127.0.0.1` only (there is no `--host`), port 4747; `--port 0` picks a free one. Prints the URL at once (on stderr with `--json`) and runs until Ctrl-C. No login: anyone logged in to this computer can open it while it runs. It writes nothing and runs no Git, model or network request. Links, folders named `*.md`, FIFOs, files over 10 MB and folders that cannot be listed are named as not shown; the CLI may still read them. An `.aimem` that is itself a link is not followed. Port in use or not allowed, bad port: `USAGE` |

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
| `UNAUTHENTICATED` (sync server: missing, unknown, revoked or expired token; HTTP 401) | 2 | `LLM_FAILED` (LLM provider missing, not logged in, timed out or failed; ADR-017) | 4 |

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
