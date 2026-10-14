# 14 — Decisions and Open Questions

Decision log in ADR style. Status: **accepted** (decided in brainstorm), **proposed** (default taken, revisit when noted). When the project starts using aimem on itself, these become `decision` records.

## Decisions

### ADR-001 — Files in git are the source of truth
- **Status:** accepted
- **Context:** Must work with every agent tool, no mandatory server, knowledge must outlive the app.
- **Decision:** Durable knowledge = markdown+YAML files under `.aimem/` committed in git. CLI, MCP, web, and server are adapters over these files.
- **Consequences:** + universal, reviewable, backed up. − git is not real-time; some queries need an index.

### ADR-002 — Two speeds of data: live state vs durable knowledge
- **Status:** accepted
- **Decision:** Claims/presence are ephemeral and bypass review (git live branch or server). Decisions/memories/etc. are durable and reviewed.
- **Consequences:** + fast coordination without weakening review. − two code paths; must keep boundaries clear.

### ADR-003 — TypeScript monorepo
- **Status:** proposed (revisit if single-binary distribution becomes a priority)
- **Decision:** TypeScript for all packages; pnpm workspaces; Node LTS.
- **Alternatives:** Go core/CLI + TS web (better binary distribution, duplicated schema).

### ADR-004 — Deterministic, offline retrieval in v1
- **Status:** superseded by ADR-014
- **Decision:** BM25 + path/link/recency/trust scoring; no LLM or embeddings required. Embeddings optional later.
- **Consequences:** + predictable, testable, free. − weaker semantic matching; mitigated by good `summary`, `tags`, `paths`.

### ADR-005 — Random IDs, not counters
- **Status:** accepted
- **Decision:** `<prefix>-<8 base32>`; global refs `<project>:<id>`.
- **Consequences:** + no branch collisions. − less readable than numbers; mitigated by titles/slugs in filenames.

### ADR-006 — Trust labels on every record
- **Status:** accepted
- **Decision:** `verified | agent | inferred`; ranking weights and display labels.
- **Consequences:** protects against agents acting on unreviewed guesses; adds a review workflow.

### ADR-007 — Supersede, never delete
- **Status:** accepted (exception: never-verified `inferred` drafts may be discarded)
- **Consequences:** + full history and safe merges. − notebook grows; mitigated by default filters on status.

### ADR-008 — Sync server is optional and self-hosted for one team
- **Status:** accepted
- **Consequences:** simple auth model, no multi-tenancy. Git mode remains first-class.

### ADR-009 — Claims via compare-and-swap on a dedicated branch
- **Status:** accepted
- **Decision:** `aimem-live` orphan branch; same-path writes make races conflict; one push wins.

### ADR-010 — Roles are a relevance lens, not access control
- **Status:** accepted
- **Consequences:** sensitive material goes to a private repo/hub. Honest about git's permission model.

### ADR-011 — Agent-facing protocol is short and generated
- **Status:** accepted
- **Decision:** A ~15-line managed block in instruction files; everything else is discoverable via `INDEX.md` and `context`.

### ADR-012 — Shell out to `git`
- **Status:** accepted
- **Consequences:** exact parity with user's git behaviour; requires git on PATH.

### ADR-013 — `adopt` produces inferred drafts and requires review
- **Status:** accepted

### ADR-014 — RAG-style hybrid retrieval in v1 (supersedes ADR-004)
- **Status:** accepted
- **Context:** The owner wants the app to behave like RAG: find knowledge by meaning, let non-developers ask questions — while keeping every original requirement (any agent tool, files in git, offline/solo, self-hosted).
- **Decision:** Retrieval = lexical (BM25) + semantic (embeddings) + metadata filters + link expansion, fused into one ranking. Embeddings are local by default (multilingual model), optional OpenAI-compatible endpoint, or off. Vectors are derived data: gitignored cache locally, `pgvector` on the server; never committed. `aimem context` needs no LLM; `aimem ask` adds an LLM-generated answer with mandatory citations and is opt-in.
- **Consequences:** + finds paraphrased/multilingual matches, enables plain-language Q&A. − extra dependency (model download, CPU), more evals, privacy surface when remote providers are used. Mitigated by lexical fallback, `allow_remote` opt-in, `no-embed` tag, and eval gates. Details: 15.

### ADR-015 — Ingest from the tools non-developers already use; one owner per record
- **Status:** accepted
- **Context:** Non-developers work in Google Docs/Sheets (and Odoo for tasks), not markdown or git. Editing inside aimem would duplicate those tools and create two versions of the truth.
- **Decision:** Non-developers upload or link documents. Connectors (upload and Google Drive in v1) ingest them into externally-owned records (`managed_by: external`, `source:`), updated one-way and read-only in aimem. An Odoo connector (Project tasks mirrored read-only, handoff notes posted to chatter) is designed but **deferred** (ADR-016). Templates give structure without LLM.
- **Consequences:** + no new tool for non-developers; no two-way sync conflicts. − connector maintenance, credentials to manage, visibility mismatch between source permissions and repo access (mitigated by allow-lists and private hubs). Details: 16.

### ADR-016 — Defer the Odoo connector
- **Status:** accepted
- **Context:** Developers and non-developers use Odoo, but the owner decided it is not needed for now. Version, edition and network placement of the Odoo instance are also unknown.
- **Decision:** v1 ingests from file uploads and Google Drive/Docs/Sheets only. The Odoo design stays in 16 §6 as a deferred section; `source.system: odoo` is reserved in the spec. Tasks in v1 are aimem-native.
- **Revisit when:** PMs need agent progress inside Odoo, or agents need to read Odoo tasks. Then resolve OQ-19, OQ-20 and OQ-22 first.
- **Consequences:** + smaller v1 (M4b shrinks); no dependency on Odoo version or network access. − tasks are not linked to Odoo; non-developers who track work in Odoo must also import task Sheets if they want them in the notebook.

## Open questions (with recommended defaults)

| ID | Question | Recommended default | Decide by |
|----|----------|--------------------|-----------|
| OQ-1 | Product/CLI name and npm package availability (`aimem` is a working name) | Check availability in M0; keep CLI short | M0 |
| OQ-2 | TypeScript vs Go for core/CLI | TypeScript (ADR-003) | M1 start |
| OQ-3 | Monorepo handling: one `.aimem/` at root with `paths` scoping, or nested `.aimem/` per package? | One root `.aimem/`, `repo:` may name a package | M3 |
| OQ-4 | Default `agent_commits` policy for team mode: `stage`, `commit`, or `pr`? | **Resolved (slice 1.4c):** `commit` for solo, `stage` for team; applies to agent writes only | M2 |
| OQ-5 | Should live branch be allowed on protected-main repos? | Yes; it is a separate branch | M3 |
| OQ-6 | Token counting method for budgets | `chars/4` heuristic with per-model override; optional tokenizer | M2 |
| OQ-7 | Tasks: is aimem the system of record, or a mirror of Jira/Linear/GitHub Issues? | aimem-native tasks in v1 (agents create them; non-developers can import task Sheets). Mirroring an external task system (Odoo/Jira/Linear) is deferred (ADR-016) | M3 |
| OQ-8 | Windows support level | Best-effort; CI on Linux+macOS; Windows smoke tests in M7 | M7 |
| OQ-9 | Open source or private; license | Decide before first publish; MIT/Apache-2.0 if open | M7 |
| OQ-10 | Semantic search (embeddings) | **Resolved → ADR-014**: in scope for v1 (M2), local model default | — |
| OQ-11 | How should sessions be identified across tools (session id)? | Tool-provided id if available else random per process; stored in claim/handoff | M3 |
| OQ-12 | Per-tool hooks (auto start/end) — build or document only? | Document recipes first; package later | M2/M7 |
| OQ-13 | Hosting for the team server (VPS, container platform, existing infra) | Single container + managed Postgres on existing infra | M6 |
| OQ-14 | Private notes: allow `visibility: private` records that stay out of git? | No for v1 (breaks the files-in-git rule); use a private repo | post-v1 |
| OQ-15 | Language of records (team may write in Indonesian/English) | Any language; `summary` recommended in the team's main language; search is language-agnostic BM25 (stemming off by default) | M2 |
| OQ-16 | Default local multilingual embedding model (quality vs size vs speed) | **Resolved (slice 2.4b):** `paraphrase-multilingual-MiniLM-L12-v2` — smallest candidate passing the gate (overall 0.93 vs lexical 0.81; e5-small 0.81; bge-m3 0.93 at 5× size). See 15 §4.2 | M2 |
| OQ-17 | LLM provider for `ask`/rerank: hosted API, local server (e.g. Ollama), or none | Support any OpenAI-compatible endpoint; ship with `none` | M6 |
| OQ-18 | May `context` ever call an LLM (query rewrite)? | No by default; opt-in `query_rewrite: llm` | M2 |
| OQ-19 | *(deferred)* Odoo version, edition (Community/Enterprise), hosting (Online / Odoo.sh / self-hosted) | Ask IT; check `/web/webclient/version_info` on the Odoo host. Connector is version-tolerant meanwhile (16 §6.1) | M4b start |
| OQ-20 | *(deferred)* Where to host the sync server if Odoo is only reachable inside the company network | Run it inside the network/VPN; CLI sync from a VPN laptop until then | M6 |
| OQ-21 | Google auth: service account + shared inbox folder, or per-user OAuth | Service account + inbox folder (least privilege, simpler for non-developers) | M4b |
| OQ-22 | *(deferred)* Which Odoo projects may be synced, and which fields are sensitive (client data) | Start with one allow-listed internal project; add field filters before adding others | M4b |
| OQ-23 | V011 (conflicting accepted decisions): warn on one record of the pair or both? | **Resolved (slice 1.2):** both records | M1 (slice 1.2) |
| OQ-24 | V010 (stale): does it apply to records already `superseded`/`deprecated`/`rejected`? | **Resolved (slice 1.2):** no; current records only | M1 (slice 1.2) |
| OQ-25 | `content_sha` (V017): exact hashing input (body as written, trimmed, LF-normalised?) | **Resolved (slice 1.2):** sha256 of the LF-normalised, trimmed body (03 §9) | M4b |
| OQ-26 | Incident `started` / `resolved_at`: datetime or free text? | UTC ISO-8601 datetime like `created`; schema keeps them as strings until decided | M1 (slice 1.2) |
| OQ-27 | When an agent edits a `verified` record (`aimem update`), should trust drop to `agent`? | Yes for body or summary changes; keep `verified` for status-only changes (e.g. task progress). Current v0.1 behaviour: trust unchanged | M2 |
| OQ-28 | Interactive `init` intake (08 §1): ask the 7 questions one by one and create records? | Yes, behind a TTY check; v0.1 prints the questions (and returns them in `--json`) | M2 (with adapters) |
| OQ-29 | `aimem link`, `discard`, `move`, `review` (04 §4) are not in M1 | Build `link` and `discard` with adopt (M4), `review` with adopt/web, `move` with the hub (M3) | M3–M4 |
| OQ-30 | What should `aimem context --deep` do? (listed in 04 without a definition) | Include full bodies for more records within a larger default budget (e.g. 2×), and follow links two hops for bodies | M2 |
