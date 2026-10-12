# 13 — Roadmap and Milestones

Sizes are relative effort, not dates: **S** ≈ a few focused days, **M** ≈ 1–2 weeks, **L** ≈ 2–4 weeks (part-time pace will stretch these). Each milestone has acceptance criteria and a demo that proves it.

## Overview

```
M0 Spec & fixtures ─► M1 Core + CLI (solo) ─► M2 Adapters + MCP ─► (dogfood starts)
                                                        │
                              M3 Team mode (git claims, hub) ─► M4 Adopt
                                                        │
                              M5 Web viewer (read-only) ─► M6 Server + realtime + web edit
                                                        │
                                                    M7 Hardening & v1
```
Solo level (M0–M2) is the first usable product and the fastest way to learn whether the record types and briefing are actually useful.

## M0 — Spec and fixtures (S)
**Deliverables**
- Spec 03 finalised for v1 (4 core types + extended stubs).
- Zod schemas + JSON Schema export (`@aimem/schema`).
- Fixtures: `tiny`, `medium`, `messy`.
- Repo scaffolding: monorepo, CI skeleton, lint/typecheck.

**Acceptance**
- `pnpm test` runs; schema round-trip property tests pass.
- Fixtures validate (or fail as expected for `messy`).

## M1 — Core library and CLI, solo mode (M)
**Deliverables**
- `@aimem/core`: records I/O, ID/slug, validate (V001–V018), index, search, `INDEX.md` render.
- CLI: `init --solo`, `add`, `show`, `list`, `search`, `update`, `supersede`, `verify`, `handoff`, `validate`, `index`, `status`, `doctor`.
- `--json` contracts, exit codes, error codes.
- Secret scanner (basic).

**Acceptance**
- In a fresh repo: `init → add decision → add memory → handoff → validate` all pass in a scripted e2e test.
- Rewrites preserve unknown keys; atomic writes verified.

## M2 — Context briefing (hybrid retrieval), adapters, MCP (L)
**Deliverables**
- `aimem context` per 06 §2 with `--explain`; briefing evals (12 §3) and first tuning.
- Hybrid retrieval (15): chunking, local multilingual embeddings with lexical fallback, vector cache, fusion, `index --embeddings`, `doctor` checks, paraphrase + multilingual evals; pick the default model by eval (OQ-16).
- Adapters: `AGENTS.md`, `CLAUDE.md`, Cursor rules, Copilot instructions, Gemini; `adapters sync/list/remove`.
- MCP server (stdio) with all tools in 05.
- Dogfood this repo with `.aimem/`.

**Acceptance**
- Evals: recall@10 ≥ 0.85, budget compliance 100% on `medium`.
- Hybrid beats lexical-only on the paraphrase and multilingual sets; with the model unavailable, `context` still works (lexical) and says so.
- Start a fresh session in two *different* agent tools on a fixture project; both obtain the briefing (via file instruction + CLI, and via MCP where supported).
- **Gate:** author uses it on one real project for a week before continuing.

## M3 — Team mode: claims on git, hub, multi-repo (M)
**Deliverables**
- `aimem-live` branch, claim CAS algorithm, heartbeat, release, steal, `live`.
- `project.yaml` multi-repo + hub resolution; global refs.
- Dedupe check; V011 conflict detection; `.gitattributes`/hooks for `INDEX.md`.
- `write_policy` (`stage|commit|pr`).
- CI recipe: `aimem validate --strict`.

**Acceptance**
- Concurrency suite (12 §4 scenarios 1–7) passes, including 20×5 stress.
- Multi-repo fixture: briefing in repo A shows hub + sibling records and warns on missing ones.

## M4 — Adopt (M)
**Deliverables**
- `aimem adopt` scan + mechanical drafts; `--dry-run`; `--agent-plan`; `review`; `discard`.
- Extractors: README/docs, ADR formats, agent-instruction files, manifests, migrations, CI, git hotspots; optional PR mining.
- Idempotency via `evidence`.

**Acceptance**
- `adopt-me` fixture yields ≤ 40 records, all `inferred`, with evidence; second run adds nothing.
- Author adopts one real running project and verifies/discards the drafts in < 1 hour.

## M4b — Connectors: upload and Google (S–M)
**Deliverables**
- Ownership model (`managed_by`, `source`), V017/V018, `READONLY_EXTERNAL`, `detach`.
- `aimem import`, `aimem templates`, sheet/doc templates; docx/xlsx/csv/pdf converters.
- Google connector (inbox folder, Docs → markdown, Sheets per tab) via `aimem sources`.
- Fixtures for CI (recorded Google API responses, import samples).
- *Deferred:* Odoo connector (design kept in 16 §6; ADR-016).

**Acceptance**
- Import report and idempotency per 16 §13 pass on fixtures.
- A real Google Doc (decision template) and a Sheet (20 tasks) import end-to-end from the inbox folder and re-sync without duplicates.
- Needs no server; scheduled sync arrives with M6.

## M5 — Web viewer, read-only (M)
**Deliverables**
- `aimem serve web` (local) and the Next.js app reading from the server index (or local working tree).
- Dashboard, search, record page, decision timeline, task board (read-only), handoff feed, role lenses.
- Import/upload page, source badges, **Edit at source** on externally-owned records.
- Markdown sanitization, a11y checks.

**Acceptance**
- A non-developer teammate answers three scripted questions ("why did we choose X?", "what's in QA?", "what happened in incident Y?") without help.

## M6 — Sync server, realtime, web editing (L)
**Deliverables**
- Server: auth (GitHub OAuth, tokens), repo indexer + webhook, claims API with transactional acquire, SSE events, audit log, Docker image.
- Shared semantic index (pgvector) and `ask` with citations: server API, CLI `aimem ask`, web Ask box (15 §10); LLM provider config and guardrails.
- Scheduled connector workers (Google) running where the sources are reachable; Google/email sign-in for non-developers (16 §9).
- CLI/MCP `sync: server` backend; `--local` fallback.
- Web: live panel, review queue, editor → PR flow, task status changes.

**Acceptance**
- Claim visible to another client in < 1 s (p95 in LAN/typical internet).
- Server concurrency tests pass; token scope enforcement tested.
- Web edit creates a PR with a clean diff and correct authorship.

## M7 — Hardening and v1 (M)
**Deliverables**
- Security checklist (09 §9) complete; performance budgets met; docs for install/upgrade; `migrate` skeleton; Windows best-effort verification.
- Packaging: npm provenance, Docker, example compose.
- 2 projects × 2 weeks dogfood; triage list closed.

**Acceptance:** release gates in 12 §7.

## First two weeks (suggested)
1. Day 1–2: monorepo scaffold, schemas, fixtures (M0).
2. Day 3–7: records I/O, validate, `init/add/show/search/handoff` (M1 core).
3. Day 8–10: index, `INDEX.md`, `status/doctor`, e2e test (M1 finish).
4. Day 11–14: `context` v0 with BM25 + paths + packing and first eval cases (M2 start).

## Post-v1 ideas (not committed)
- Cross-encoder reranking by default and weights learned from usage feedback.
- VS Code / JetBrains side panel.
- Slack/Teams notifications and "ask the notebook" bot.
- Jira/Linear two-way task sync.
- Analytics: knowledge coverage, review debt, most-used records.
- Importers from other agent-memory formats.
- Per-tool deep integrations (hooks, slash commands) as optional packages.
- Multi-tenant hosted version (explicitly out of scope for now).
