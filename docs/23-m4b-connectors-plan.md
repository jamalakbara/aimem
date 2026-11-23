# 23 — M4b Connectors Plan (upload and Google)

Status: **approved by the owner (2026-11-23) with the recommended defaults below.** Slices land one PR at a time; this line records which are implemented: **4b.1** (upsert by source, `detach`, `import` of `.md`/`.txt`, `kind: reference`; `verify` stays allowed on imported records because it is how a second person reviews them; upload `source.id` is the file path, not a content hash, so edits update instead of duplicating), **4b.2a** (CSV sheets, `templates list|export` for csv/md, `--allow-outside` for agents, a PID-aware import lock, V019 for duplicate source keys), **4b.2b** (xlsx import and templates through `fflate` 0.8.2 and a minimal XML reader instead of `exceljs`: limits are checked while inflating, DTDs are refused, nothing touches disk). It turns 16 (connectors and ingestion) and the M4b entry in 13 into PRs. The Odoo connector stays deferred (16 §6, ADR-016).

Already in `main`: the ownership fields (`managed_by`, `source`, 03 §2.1, 16 §2.1), V017 (body differs from `source.content_sha`) and V018 (`source.state` not `ok`), and `READONLY_EXTERNAL` on `update`, `move` and `discard`. Missing: `detach`, `import`, `templates`, `sources`, the converters and the Google connector.

M4b acceptance (13, 16 §13):
- A filled Sheet template of 20 tasks and a Decision Doc import without help; bad rows are reported by row.
- Re-importing or syncing creates no duplicates and updates changed records.
- Editing an externally-owned record is refused with an "edit at source" message.
- A Google Doc in the inbox folder imports, and updating the Doc updates the record on the next sync. No server: sync is run by hand (`aimem sources sync`); scheduling arrives with M6.

## Slice order

| Slice | Scope | Proof |
|-------|-------|-------|
| 4b.1 | Core upsert by `source` key `(system, id[, row])` with `content_sha`, `version`, `synced_at`, `imported_by`, `state`; `aimem detach <ref>`; `aimem import <file>` for `.md`/`.txt`: document templates (16 §4.2) and whole-document mode | Same file imported twice → one record, updated when the file changes; V017 clean after import; `detach` stops sync and allows edits |
| 4b.2 | Sheet templates: `.csv` and `.xlsx` (one row = one record, 16 §4.1) for tasks, testcases and incidents; row-level error report; `aimem templates export <type> --format md|csv|xlsx` | 20-task fixture sheet → 20 tasks; a bad row is reported with its number and the good rows still import; re-import updates by row |
| 4b.3 | Converters: `.docx` → markdown, `.pdf` → text (whole-document mode); 10 MB default limit; `--keep-original` into `.aimem/attachments/` | Fixture docx with a decision template becomes a decision; a pdf becomes a reference memory; over-limit file refused |
| 4b.4 | Google connector: `aimem sources add google --folder <id>`, `sources list`, `sources sync`; Docs exported as markdown, Sheets read per tab; removed/unshared → `state: missing`; `SOURCE_AUTH` / `SOURCE_UNREACHABLE` | Recorded API responses in CI: new doc imports, changed revision updates, deleted doc → V018, expired credentials → `SOURCE_AUTH` with no partial writes |

Each slice is one PR. 4b.1 alone already helps (import a markdown decision doc); 4b.2 covers the first acceptance item; 4b.4 the Google ones.

## Decisions to confirm before coding

1. **Trust of imports.** 16 §3.1 makes template and whole-document imports `verified` when a human imports them. QA points out that this would let an unread file skip `durable_requires_review` (M3.7). Recommended: a human import is `verified` except for decision, runbook and schema records in team mode, which follow `durable_requires_review` (a second person verifies, like any human write); an agent importer gets `trust: agent`. `--extract llm` (inferred drafts) stays out of M4b.
2. **Whole-document kind.** 16 §3.1 names `kind: reference`, which the memory schema does not have yet (`gotcha, constraint, howto, fact, preference`). Recommended: add `reference` to the schema (a small, deliberate contract change), rather than reusing `fact`.
3. **Dependencies** (pinned exact versions; their zip readers reviewed; per-file time, page and memory limits for PDF and zip on top of the 10 MB size limit). Recommended: `mammoth` (BSD-2) for docx, `exceljs` (MIT) for xlsx read/write, `unpdf` (MIT, pdf.js inside) for pdf text, all loaded lazily so the CLI start time is unchanged; no `googleapis` package: plain `fetch` against the Drive and Sheets REST APIs with a small JWT signer from `node:crypto`.
4. **Google auth.** The key file must lie outside the repository working tree; a path inside it is refused with a clear message, so the key can never be committed. Recommended: a service account whose key file path comes from `GOOGLE_APPLICATION_CREDENTIALS` (or `AIMEM_GOOGLE_CREDENTIALS`), shared only with the inbox folder; read-only scopes `drive.readonly` and `spreadsheets.readonly`. Per-user OAuth is left for the server (M6). Secrets never go into `project.yaml` (16 §8).
5. **Selection.** Only the configured inbox folder (and files explicitly passed to `sources add google --file <id>`), never the whole Drive (16 §5). Subfolders are not walked in M4b.
6. **Write policy and identity.** One commit (or `aimem/*` branch) per `import` or `sources sync` run, like `adopt`, with the importer as author. The bot identity with an `On-Behalf-Of` trailer belongs to the server (M6).
7. **Original files.** Not stored by default; `--keep-original` writes `.aimem/attachments/<sha256>.<ext>` and warns about repository size above 1 MB (Git LFS is the user's choice). A file that was skipped (secret, limits, parse error) is never kept, and the docs warn that binary originals can carry macros or hidden content that the text scan does not see.
8. **Visibility warning.** Every import and sync prints once: "Imported content is visible to everyone who can read this repository" (16 §12).

## 4b.1 — Upsert, detach, markdown import

- Core `upsertExternal(nb, { type, title, summary, body, fields, source }, deps)`: finds the record by `source.system` + `source.id` (+ `row`), creates or rewrites it, sets `content_sha` (03 §9) and `synced_at`, never touches a notebook-owned record, refuses a key owned by another system (16 §2 rule 4).
- `aimem detach <ref>`: drops `managed_by`/`source` into a `detached_from` note in the body footer, keeps history; afterwards `update` works and sync skips it.
- `aimem import <file> [--type decision|runbook|incident|memory] [--author]`: `.md`/`.txt`; template matching per 16 §4.2 (headings case-insensitive, Doc title → `title`, optional `Roles:`/`Tags:` lines); missing required headings → whole-document mode with a warning. `source.system: upload`, `source.id: sha256 of the file`.
- Every write command refuses an externally-owned record with `READONLY_EXTERNAL` and an "edit at source" message, not only `update`, `move` and `discard`: also `verify`, `supersede` (as old or new record), `review` edits and MCP write tools (QA plan: ownership first, before any converter).
- Tests first: template decision/runbook/incident/memory; fallback to whole document; re-import unchanged (no write), changed (update, new `content_sha`); `update` refused with `READONLY_EXTERNAL`; `detach` then `update` works; secret in the file → nothing written, report names the line.

## 4b.2 — Sheets

- `.csv` (RFC 4180) and `.xlsx` (first tab, or `--sheet <name>`); header normalisation per 16 §4.1 (case-insensitive, spaces → `_`); unknown columns become a small table in the body; `source.row` is the sheet row number.
- Report: `imported`, `updated`, `unchanged`, `errors[{row, reason}]`; exit 1 with `--strict` when any row failed.
- `aimem templates export tasks|testcases|incidents|decision|runbook|incident|memory --format md|csv|xlsx [--out <path>]`.

## 4b.3 — docx and pdf

- docx via `mammoth` → HTML → markdown (headings, lists, simple tables); images dropped, alt text kept. pdf via `unpdf` → text, whole-document mode only.
- Size limit 10 MB (`--max-size`); `--keep-original`.
- Tests first, from the QA plan (`/var/lib/openbot/OpenBot/Shared/aimem-m4b-m5-qa-test-plan.md`, Opan): zip bombs in docx/xlsx (limit the uncompressed size and entry count before reading), zip entries with `../` or absolute paths (never extracted to disk), XML external entities (XXE) in docx/xlsx, spreadsheet formulas (`=cmd|…`, `=HYPERLINK(…)`) imported as plain text and never evaluated, malformed and script-carrying PDFs (text only, no JavaScript, time limit per file).

## 4b.4 — Google connector

- A sync that stops halfway (crash, network) leaves nothing half-written: each record is written atomically and a re-run reaches the same end state.

- Config `connectors.google.inbox_folder_id` and `poll_minutes` (only used by M6) in `project.yaml`; credentials from env.
- `sources sync`: list the folder (`files.list` with `q='<id>' in parents and trashed=false`), Docs via `files.export` (`text/markdown`), Sheets via `spreadsheets.values.get` per tab; `version` = Drive `version`/`modifiedTime`; unchanged versions are skipped; files no longer listed → `state: missing` (V018), content kept.
- Errors: 401/403 → `SOURCE_AUTH`, nothing written; network/5xx → `SOURCE_UNREACHABLE` with the last good records kept; per-file errors are reported and the run continues.
- CI uses recorded responses (fixtures under `fixtures/google/`), never the network.
- Credentials never reach `.aimem/`, `calls.jsonl`, logs or error messages; tests assert that the key file contents and access tokens do not appear in any output.

## Expected files

| Area | Files |
|------|-------|
| Schema | `packages/schema/src/record.ts` (`kind: reference`), contract snapshots |
| Core | `packages/core/src/ingest/{upsert,templates,sheet,convert}.ts`, `packages/core/src/connectors/google.ts`, `packages/core/src/ops/detach.ts` |
| CLI | `packages/cli/src/commands/{import,templates,sources,detach}.ts`, `packages/cli/src/run.ts` |
| Fixtures | `fixtures/imports/**` (md, csv, xlsx, docx, pdf samples), `fixtures/google/**` (recorded responses) |
| Docs | 04 (`import`, `templates`, `sources`, `detach`), 16 (final behaviour), 13 (M4b status) |

## Out of scope

Odoo (deferred), LLM extraction (`--extract llm`), the web upload page and scheduled sync (M5/M6), OCR, pptx.
