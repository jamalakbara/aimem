# 00 — Vision and Scope

> Working name: **aimem** (CLI) / "AI Knowledge Keeper" (project). Status: draft v0.1.

## 1. Problem

AI coding agents start every session with no memory of previous sessions. Knowledge produced during work — decisions and their reasons, gotchas, incidents, half-finished tasks — lives in chat logs and people's heads. Consequences:

- A new agent session redoes or contradicts earlier work.
- Different agent tools (Claude Code, Cursor, Codex, Copilot, ...) each start blank and cannot share what the others learned.
- Non-developer roles (PM, QA, DevOps, DB, error analysts) cannot see what agents did or why.
- Every team stores project knowledge differently, so nothing is reusable across projects.

## 2. Product statement

**aimem is a shared, versioned project notebook that humans and AI agents both read from and write to, stored as plain files in git, in one standard structure across all projects.**

## 3. Goals

| # | Goal | Measure of success |
|---|------|--------------------|
| G1 | An agent starting a session can get a *relevant, compact* briefing in one command | `aimem context` returns under the token budget and contains the expected records in fixture tests |
| G2 | Works with every agent tool | Minimum: any agent that can read files or run a shell works with no plugin |
| G3 | One standard structure across projects | `aimem validate` passes on any project; schema is versioned |
| G4 | Readable by every role | Role views exist; every record is plain markdown a human can read without the app |
| G5 | Works for 1 repo or many; 1 person or a team | Same file format in all modes; mode is config only |
| G6 | Detect and reduce duplicate work between concurrent agents/people | Claims visible to other sessions; conflicts flagged by `validate` |
| G7 | Works for new and already-running projects | `aimem init` and `aimem adopt` both produce a valid `.aimem/` |
| G8 | Knowledge survives the tool | If the app disappears, the files remain useful |
| G9 | Retrieval finds relevant knowledge by meaning, not just keywords; humans can ask questions in plain language | Hybrid search beats keyword-only on paraphrase and multilingual evals; `aimem ask` answers with citations or says "not found" (15) |
| G10 | Non-developers keep working in Google Docs/Sheets; their content is ingested, not retyped | A non-developer imports a templated Sheet/Doc and sees records without using git or markdown (16) |

## 4. Non-goals (v1)

- Not a replacement for the issue tracker or code review. Tasks here are lightweight and can link to external trackers.
- Not a *general-purpose* RAG platform or document-chat product, and not a vector-database service for other apps. Retrieval is RAG-style but purpose-built for project records: hybrid keyword + semantic search, with optional cited answers (see 15).
- Not a chat-history archive. We store *distilled* knowledge, not transcripts.
- No mobile or desktop app. CLI + MCP + web viewer only.
- Not multi-tenant SaaS. The sync server is self-hosted for one team.
- Does not run or orchestrate agents. It informs them.
- No two-way sync with external tools and no editing of imported content inside aimem: externally-owned records are updated from their source only (16 §2).

## 5. Users and what each needs

| Role | Key needs | Primary surfaces |
|------|-----------|------------------|
| Developer | Context before coding; record decisions and gotchas | CLI, agent, repo files |
| AI agent | Compact briefing; place to write findings; know what others are doing | CLI/MCP, AGENTS.md pointers |
| Project manager | Task status, decision timeline, who is doing what | Web viewer |
| QA | What changed, what needs verifying, bug/test records | Web viewer |
| Database engineer | Schema notes, migration decisions, data gotchas | Web viewer, repo files |
| DevOps | Runbooks, deploy notes, incidents | Web viewer, repo files |
| Error analyst | Incident history, root causes, recurrence | Web viewer |

## 6. Operating modes

| Mode | Repos | People | Sync | Infra |
|------|-------|--------|------|-------|
| Solo | 1 or more | 1 | git | none |
| Team | 1 or more (optional hub) | many | git (claims on a live branch) | none |
| Team + realtime | 1 or more (optional hub) | many | sync server | 1 small self-hosted server |

Mode is set in `.aimem/project.yaml` (`mode`, `sync`). Files do not change between modes.

## 7. Key product decisions (summary)

1. Files in git are the source of truth; everything else is an adapter. (ADR-001)
2. Two speeds of data: *live state* (claims, presence) vs *durable knowledge* (decisions, memories). (ADR-002)
3. Records are never deleted; they are superseded. (ADR-007)
4. Inferred content is always labelled and ranked lower. (ADR-006)
5. Retrieval is hybrid (keyword + semantic), RAG-style; vectors are a rebuildable index, never the source of truth. (ADR-014)
6. Non-developers keep working in Google Docs/Sheets; connectors ingest from them (Odoo deferred), and externally-owned records are read-only in aimem. (ADR-015)

Full list: [14-decisions-and-open-questions.md](14-decisions-and-open-questions.md).

## 8. Success criteria for v1 (dogfood)

- Used on 2+ of the author's own real projects for 2 weeks.
- A fresh agent session on a project with 30+ records produces correct context in under 5 seconds.
- Two agents started on the same task are warned about each other.
- A non-developer can find "what was decided about X and why" in the web viewer without using git.

## 9. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Nobody writes records | Notebook stays empty | Agents write by default via protocol + session-end handoff; humans only review |
| Notebook fills with noise | Briefings get bloated | Strict record criteria, dedupe check, token budget, staleness |
| Agents trust wrong/stale facts | Wrong work | trust labels, `verified` date, supersede, stale decay |
| Poisoned/malicious record steers agents | Security | Review for durable records, CODEOWNERS, briefing framed as reference data (see 09) |
| Overlaps with CLAUDE.md/ADR folders/Notion | Low adoption | Position as the *standard structure + retrieval + role views* layer; import existing files |
| Git-speed coordination too slow | Duplicate work | Optional realtime server |
| Semantic search returns plausible but wrong records | Agents act on wrong context | Hard metadata filters (no superseded), trust/freshness weights, citations in `ask`, eval gates (15 §15) |
| Imported documents expose content beyond its original audience | Restricted information becomes visible to everyone who can read the repo | Explicit selection and allow-lists only, warning at import, private hub for sensitive material (16 §12, 09 T13) |
