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

### ADR-017 — Claude Code print mode as a local LLM provider
- **Status:** accepted (T2)
- **Context:** `aimem ask` (15 §10) needs an LLM. Many users already have Claude Code signed in; asking them for a separate API key, stored by aimem, adds a secret to manage. OQ-17 recommended an OpenAI-compatible endpoint; this adds a second option without changing that default.
- **Decision:** `retrieval.llm.provider: claude-cli` shells out to `claude -p` and reuses the user's Claude Code login. aimem stores no key. Flags: `--output-format json --tools "" --no-session-persistence --strict-mcp-config --disable-slash-commands --setting-sources ""`, the rules passed with `--system-prompt-file`, the prompt on stdin, and the run happens in an empty temp directory with a timeout (`timeout_seconds`, default 120). **Not `--bare`:** bare mode reads only `ANTHROPIC_API_KEY` or an `apiKeyHelper` and never the OAuth login, so it would defeat the point; the extras it skips are switched off one by one instead. Record text goes to Anthropic, so the provider stays off until `retrieval.llm.allow_remote: true`. Failures map to `LLM_FAILED` (exit 4). Binary override: `AIMEM_CLAUDE_BIN`. Default stays `none`.
- **Verified (Claude Code 2.1.304, Windows, 2026-11-16):** with these flags the model reported no tools; no hook or plugin text reached it (a user SessionStart hook was installed); no session was saved under `~/.claude/projects`; auth came from the login with `ANTHROPIC_API_KEY` unset; a multi-line system prompt passed through the `.cmd` shim via the file; about 6 s per call. With `--setting-sources ""` the user's default model setting is not read, so set `retrieval.llm.model` (e.g. `sonnet`) for answer quality.
- **Consequences:** + no API key in aimem; works wherever Claude Code is signed in. − depends on Claude Code's CLI flags staying stable (pinned by tests on the argument list); slower start (~1–2 s) than an HTTP call; usage counts against the user's Claude plan.

## Open questions (with recommended defaults)

### T3 — Codex CLI provider verification (2026-11-16)

**Recommendation: no-go for implementation on the tested build until zero-tool
operation can be verified.** Login-based generation works, but the `ask` contract
requires no tools (15 §10). Keep `claude-cli` as the implemented login-based provider;
do not add a `codex-cli` schema value on the strength of this probe.

| Check | Observed result |
|-------|-----------------|
| Installed CLI | Desktop-bundled `codex-cli 0.169.0-alpha.11.1`, Windows; no installation needed |
| Authentication | `codex login status`: ChatGPT login. Real calls succeeded with `OPENAI_API_KEY` and `CODEX_API_KEY` removed from the child environment |
| Non-interactive | Prompt on stdin through the existing `execaRunner`, fresh temporary working directory, 90 s timeout; exit 0 in 5.2–7.4 s |
| Output | `--json` emits JSONL: `thread.started`, `turn.started`, `item.completed` with `item.type=agent_message` and `item.text`, then `turn.completed.usage` |
| Usage | Observed `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens` |
| Session files | Zero new `.jsonl` files under the existing Codex home `sessions/` tree after each of three `--ephemeral` calls. This does not establish absence of other local caches/logs or server retention |
| Tool disabling | `codex exec --tools "" --help` rejects `--tools`. With the feature switches below, two model responses still listed `functions.exec`, wait/input helpers and collaboration tools. Self-report is not authoritative proof of tool execution |
| Additional check | A request to use only `functions.exec` for `text(6 * 7)` returned `42`, but JSONL included only an agent message and no tool event. That result cannot establish whether a tool actually ran |
| Environment isolation | Removing inherited `CODEX_*` variables except `CODEX_HOME` did not change the reported tool list. No login files were copied or modified |

Exact tested arguments (line breaks here are for readability; pass as an argv array):

```text
codex -a never exec --ignore-user-config --ignore-rules --ephemeral
  --skip-git-repo-check --sandbox read-only --json --color never
  -c project_doc_max_bytes=0 -c web_search="disabled"
  --disable shell_tool --disable apps --disable plugins --disable hooks
  --disable skill_search --disable multi_agent --disable multi_agent_v2
  --disable browser_use --disable computer_use --disable image_generation
  --disable view_image --disable sleep_tool -
```

Capability prompt: ask for `T3_OK` and exposed tool names, explicitly forbidding tool
calls, file access, browsing and delegation. Only synthetic prompts were sent. The
first call inherited desktop environment variables; the next two removed `CODEX_*`
except `CODEX_HOME`. All removed `OPENAI_API_KEY`; removing all `CODEX_*` also removes
`CODEX_API_KEY`. No particular model was selected, so these observations are specific
to this installed build and its default model, not a cross-model guarantee.

The CLI help documents `--ignore-user-config` as retaining access to authentication
through Codex home. Official references describe
[non-interactive JSONL and ephemeral execution](https://developers.openai.com/codex/noninteractive)
and [individual tool/configuration switches](https://developers.openai.com/codex/config-reference).
Neither a read-only filesystem sandbox nor a prompt saying "do not use tools" proves
zero tools are exposed. We found no verified all-tools-off invocation in this check.

Revisit with an officially supported zero-tool mode or authoritative request/tool
inventory evidence, then test inherited MCP/plugins/hooks, prompt isolation, failure
mapping and output parsing before implementation. This is a bounded no-go for the
tested build, not a claim that every Codex version is unsuitable.

Real-model evaluations can continue locally through the existing Claude Code login.
The optional GitHub Actions evaluation job still requires its separately configured
key; skipping that setup does not prevent local evaluation (12 §3.1).

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
| OQ-17 | LLM provider for `ask`/rerank: hosted API, local server (e.g. Ollama), or none | Support any OpenAI-compatible endpoint; ship with `none`. `claude-cli` (Claude Code login) added by ADR-017 | M6 |
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
