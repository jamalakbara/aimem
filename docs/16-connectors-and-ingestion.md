# 16 — Connectors and Ingestion (Google, Uploads; Odoo deferred)

> Non-developers already work in Google Docs and Google Sheets (and, at their company, Odoo). They should not have to learn markdown, git, or a new editor. aimem **ingests from the tools they already use** (ADR-015).

> **Scope:** v1 = file upload + Google Drive/Docs/Sheets. The Odoo connector (§6) is designed but **deferred** (ADR-016); everything else here applies without it.

## 1. Principle

- Non-developers **upload or link** documents; they do not edit records inside aimem.
- Developers and agents keep using files, CLI and MCP as before.
- Everything ingested ends up as normal records in `.aimem/`, so agents, search, retrieval and the web app treat them like any other record.

## 2. Ownership model: one owner per record

| Kind | Frontmatter | Lives in | Edited | Sync |
|------|-------------|----------|--------|------|
| **Notebook-owned** (default) | `managed_by: notebook` | git | in git / CLI / MCP / web editor | n/a |
| **Externally-owned** | `managed_by: external` + `source:` | git (as a mirror) | **at the source** (Google Doc/Sheet, Odoo) | one-way: source → record |

Rules:
1. aimem never writes back into a source's content. The only planned exception is appending a note to an Odoo task's chatter (§6.5, deferred).
2. Tools refuse local edits to externally-owned records (`READONLY_EXTERNAL`). `validate` warns if the body no longer matches `source.content_sha` (V017).
3. `aimem detach <ref>` makes a record notebook-owned permanently and stops syncing it (escape hatch).
4. Two sources may never own the same record.

### 2.1 The `source` object

```yaml
managed_by: external
source:
  system: google-doc          # google-doc | google-sheet | odoo | upload
  id: 1AbCdEf…                # stable id: Drive file id | "project.task:1234" | sha256 of upload
  url: https://docs.google.com/document/d/1AbCdEf…/edit
  row: 12                     # only for spreadsheet rows
  version: "rev-87"           # revision / etag / Odoo write_date at last sync
  content_sha: "…"            # hash of the body we wrote
  synced_at: 2026-10-12T03:00:00Z
  imported_by: human:rina     # who selected or uploaded it
  state: ok                   # ok | missing | error
```

**Idempotency:** the key is `(system, id[, row])`. Import/sync finds the existing record by `source` and updates it; it never duplicates. No separate state file is needed for correctness (cursors are only an optimisation).

## 3. Ingest pipeline

```
fetch ─► normalise ─► map ─► scan ─► write ─► review
```

| Step | What happens |
|------|--------------|
| fetch | Connector reads the source (API call or uploaded file); records `version` |
| normalise | Convert to markdown text and/or tabular rows |
| map | Turn into typed records (see modes below) |
| scan | Secret scan, size limits, injection-delimiter neutralisation (09 §3–4). Failures are reported per item, never silently dropped |
| write | Create/update records with `source`; commit/PR per `write_policy` (bot identity with `On-Behalf-Of` trailer) |
| review | Items needing review land in the review queue (10 §5.4) |

### 3.1 Mapping modes

| Mode | Input | Output | Trust | LLM needed |
|------|-------|--------|-------|-----------|
| **Template** (structured) | Doc with known headings, or Sheet with known columns | Typed records (decision, task, testcase, incident, runbook…) | `verified` when the importer is a human | no |
| **Whole document** | Any document | One `memory` (`kind: reference`) holding the full text + link to the source | `verified` (deliberate upload) | no |
| **Extraction** (opt-in) | Free-form document | Draft records with `evidence` | `inferred` | yes |

## 4. Templates for non-developers

Provided by `aimem templates export <type> --format xlsx|md|csv`. A Sheet or .xlsx can be uploaded to Google Drive and opened as a Google Sheet.

### 4.1 Sheet templates (one row = one record)
Header names equal frontmatter field names (case-insensitive; spaces → `_`). Unknown columns are appended to the body as a small table.

| Type | Columns |
|------|---------|
| tasks | `title`, `summary`, `status`, `priority`, `assignee`, `roles`, `tags`, `due`, `paths`, `notes` |
| testcases | `title`, `summary`, `preconditions`, `steps`, `expected`, `status`, `covers`, `automation` |
| incidents | `title`, `summary`, `severity`, `started`, `resolved_at`, `services`, `impact`, `root_cause`, `fix` |

Row-level validation: a bad row yields an error report (row number + reason); good rows are still imported.

### 4.2 Document templates (one doc = one record)
Headings are matched case-insensitively.

| Type | Expected headings (H1/H2) |
|------|---------------------------|
| decision | Summary · Status · Context · Decision · Consequences · (Alternatives) |
| runbook | Summary · When to use · Steps · Rollback · Verify |
| incident | Summary · Severity · Impact · Timeline · Root cause · Fix · Prevention |
| memory | Summary · (body) |

The Doc title becomes `title`; a "Roles:" and "Tags:" line under the title is optional metadata. Missing required headings → the doc falls back to **Whole document** mode with a warning.

## 5. Google Drive connector

| Aspect | Design |
|--------|--------|
| Docs | Exported as **Markdown** through the Drive API export (supported for Google Docs) |
| Sheets | Read per tab with the Sheets API, or export as `.xlsx`. (CSV export covers only the first tab.) |
| Selection | Explicit only: a designated **inbox folder** and/or individually shared files/links. Never the whole Drive |
| Auth | Preferred: a service account (or workspace-level app) given access to the inbox folder only. Alternative: per-user OAuth with a read-only scope |
| Change detection | Poll `modifiedTime`/revision every `poll_minutes` (default 15) |
| Removed / unshared / moved out | Record gets `source.state: missing` (V018); content kept; nothing deleted |
| Fidelity | Images and drawings dropped (alt text kept); comments/suggestions ignored; complex merged tables degrade to simple markdown tables |

## 6. Odoo connector (DEFERRED — not in v1)

> Kept for later (ADR-016). Nothing in v1 depends on it, and the `odoo` value of `source.system` is only reserved. Revisit after confirming the Odoo version, edition and network placement (OQ-19, OQ-20, OQ-22).

### 6.1 Version tolerance
Your Odoo version and edition may not be known when this is built, so the connector hides the transport behind a thin `OdooClient` interface:

| Transport | Used for | Notes |
|-----------|----------|-------|
| `json2` | Odoo 19+ | HTTP+JSON API with API keys; model and method in the URL; named arguments. Per Odoo's documentation as reported by a third-party write-up — **verify against the official docs for your version** |
| `legacy` | Older versions (and 19.x while still available) | XML-RPC (`/xmlrpc/2`) or JSON-RPC (`/jsonrpc`). Deprecated from 19 with removal announced (reported timelines differ by hosting type), so avoid building new features only on it |

`transport: auto` reads `GET /web/webclient/version_info` (no login needed) to choose. Only stable ORM operations are used: `search_read`, `search_count`, `read`, and `message_post`.

### 6.2 Credentials and access
- A **dedicated integration user** (e.g. "aimem-bot"), never a personal account.
- Access rights limited to the **allow-listed projects** (use Odoo access rules / project followers).
- API key (or password on old versions with no API keys) stored in the server's secret store or an env var; never in git.
- Posting to chatter may require more than read access on the task. Test with the restricted user; grant the minimum that works.

### 6.3 Network placement
If the Odoo host is internal (VPN/intranet only), the connector must run **inside that network**: the sync server hosted on the company network, or the CLI (`aimem sources sync`) on a laptop connected to the VPN. A cloud-hosted server cannot reach it (OQ-20).

### 6.4 Project tasks → `task` records (read mirror)

| Odoo `project.task` | aimem |
|---------------------|-------|
| `id`, record URL | `source.id = "project.task:<id>"`, `source.url` |
| `project_id` | tag `project:<name>`; must be on the allow-list |
| `name` | `title` |
| `description` (HTML) | body (HTML → markdown); `summary` = first sentence |
| `stage_id` (name) | `status` via configurable `stage_map` (unmapped → `open` + warning) |
| `priority` | `priority` (`p1` for starred, else `p2`) |
| `user_ids` | `assignee` |
| `date_deadline` | `due` |
| `tag_ids` | `tags` |
| `parent_id` / `child_ids` | `links` |
| `write_date` | `source.version`; sync cursor |

Scope controls (essential — individual Odoo projects can hold thousands of tasks):
- **Allow-list of projects is required**; nothing syncs by default.
- Sync only open tasks plus tasks closed in the last `include_done_days`.
- Page size 200, backoff on errors, hard cap per run (continues on next run).
- Optional field filters to drop customer/contact data.

Ownership: Odoo owns Odoo-linked tasks (OQ-7 resolved). aimem-native tasks remain for agent-only work. Claims (07) can target either kind by ref.

### 6.5 Write-back (opt-in, append-only)
When `post_handoffs: true`, `aimem handoff --task <odoo-linked-ref>` posts a short note to that task's chatter via `message_post`: Done / Not done / Next / Blocked, a link to the record, and "Posted by aimem on behalf of <name>". It never changes stage, assignee, or fields in v1. Content is secret-scanned and length-capped. This lets PMs and QA read agent progress where they already work.

### 6.6 Later
Stage updates, creating tasks, Helpdesk tickets ↔ incidents, Knowledge/Documents as sources, and an Odoo module that shows aimem context inside the task form (version-specific custom module). One comparison source lists Knowledge, Documents, Helpdesk and Spreadsheet as Enterprise-only; confirm before depending on them. v1 needs only Project.

## 7. Upload connector

Web upload page and CLI `aimem import <file>`.

| Type | Conversion | Fidelity |
|------|------------|----------|
| `.md`, `.txt` | direct | high |
| `.docx` | → HTML → markdown (e.g. mammoth; optional pandoc) | good |
| `.xlsx`, `.csv` | rows via sheet templates | good for templated sheets |
| `.pdf` | text extraction | tables/scans poor; OCR out of scope |
| `.pptx` | slide text | low |

Max file size default 10 MB. The original file is **not** stored in git by default (only the records and `source.id = sha256`); `--keep-original` stores it under `.aimem/attachments/` (use Git LFS for large files).

## 8. Configuration (`project.yaml`, no secrets)

```yaml
connectors:
  google:
    inbox_folder_id: "<drive-folder-id>"
    poll_minutes: 15
  # odoo: ...                        # deferred (ADR-016); planned settings are described in §6
```
Secrets come from env or the server secret store (e.g. the Google credentials file path).

## 9. Where it runs

| Mode | How imports happen |
|------|--------------------|
| No server | Manual: `aimem import <file>`; `aimem sources sync` from a machine that can reach the sources |
| Server | Scheduled workers per source (07 §4.6); web upload page; status and errors in the web app |

## 10. Experience for a non-developer

1. Drop a file on the Import page, paste a Google link, or put the doc in the **aimem inbox** Drive folder.
2. The app reports: "Imported 3 records (2 verified, 1 needs review)" with row-level errors if any.
3. Records show a **source badge** (Google Doc / Sheet / upload), an **Edit at source** link, **Sync now**, and last-synced time.
4. Updating the source updates the record on the next sync; history stays in git.

## 11. Failure modes

| Situation | Behaviour |
|-----------|-----------|
| Source unreachable | Retry with backoff; last good record kept; status shown in web + `doctor` |
| Auth expired/revoked | `SOURCE_AUTH`; alert in web; no partial writes |
| Source deleted/unshared | `source.state: missing` (V018); record kept |
| Column/heading renamed | Row/doc error report; fallback to whole-document mode where possible |
| Same doc imported twice | Update, not duplicate (idempotency by `source`) |
| Local edit to external record | Rejected; or V017 if edited directly in git |
| *(deferred)* Odoo stage not in `stage_map` | `status: open` + warning |
| Huge source | Capped per run; continues next run |

## 12. Security and privacy

- **Visibility mismatch:** Google (and, later, Odoo) permissions are finer-grained than git. Once ingested, content is visible to everyone who can read the repo. Therefore: explicit selection and allow-lists only; a warning at import time; sensitive sources go to a private hub (09 T13).
- **Client/customer data:** imported documents (and, later, task systems) may contain personal or client data. Select sources deliberately; use field filters.
- **Credentials:** least privilege, secret store, rotation (09 T12).
- **Imported text is untrusted:** wrapped and labelled like any record when shown to agents (09 §3).
- **Audit:** every sync run is recorded (`source_runs`, 07 §4.3).

## 13. Acceptance criteria

- A non-developer imports a filled Sheet template of 20 tasks and a Decision Doc without help; bad rows are reported by row.
- Re-importing or syncing changes updates records and creates no duplicates.
- Editing an externally-owned record in aimem is refused with a clear "edit at source" message.
- A Google Doc in the inbox folder imports as a record within one poll interval, and updating the Doc updates the record on the next sync.
- *(Deferred)* Odoo acceptance criteria will be written when §6 is built.
