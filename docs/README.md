# aimem — Developer Documentation

> A shared, versioned project notebook that humans and AI agents both read from and write to — plain files in git, one standard structure across every project.

Status: **draft v0.1** — produced from the initial brainstorm. Working name `aimem`.

## Reading order

| # | Document | Read it to learn |
|---|----------|------------------|
| 00 | [Vision and Scope](00-vision-and-scope.md) | Problem, goals, non-goals, users, modes, risks |
| 01 | [Concepts and Glossary](01-concepts-and-glossary.md) | Shared vocabulary |
| 02 | [Architecture](02-architecture.md) | Layers, components, data flows, failure modes |
| 03 | [File Format Specification](03-spec-file-format.md) | **The contract**: records, fields, `project.yaml`, validation |
| 04 | [CLI Reference](04-cli-reference.md) | Every command, flags, JSON contracts |
| 05 | [MCP Server](05-mcp-server.md) | Tools/resources/prompts for agents |
| 06 | [Agent Integration and Briefing](06-agent-integration.md) | The agent protocol and the `context` ranking algorithm |
| 07 | [Sync and Concurrency](07-sync-and-concurrency.md) | Claims, git live branch, sync server, API, DB model |
| 08 | [Init and Adopt](08-init-and-adopt.md) | New vs running projects |
| 09 | [Security and Privacy](09-security-and-privacy.md) | Threat model, secrets, prompt-injection, auth |
| 10 | [Web App](10-web-app.md) | Role lenses, screens, edit-via-PR |
| 11 | [Tech Stack and Repo Layout](11-tech-stack-and-repo-layout.md) | Stack choices, packages, conventions, CI |
| 12 | [Testing Strategy](12-testing-strategy.md) | Test layers, fixtures, evals, concurrency tests |
| 13 | [Roadmap and Milestones](13-roadmap-and-milestones.md) | M0–M7 with acceptance criteria |
| 14 | [Decisions and Open Questions](14-decisions-and-open-questions.md) | ADR log and what is still undecided |
| 15 | [Retrieval and RAG](15-retrieval-and-rag.md) | Hybrid search, embeddings, chunking, vector storage, `aimem ask` |
| 16 | [Connectors and Ingestion](16-connectors-and-ingestion.md) | Google Docs/Sheets and uploads (Odoo deferred); externally-owned records; templates |
| 17 | [Build Playbook for Claude Code](17-claude-code-build-playbook.md) | How to build aimem with a coding agent: flow, prompts, slices, definition of done |

## Reading paths

- **Building the core/CLI:** 00 → 01 → 03 → 04 → 06 → 11 → 12 → 13 (M0–M2)
- **Agent integration / MCP:** 05 → 06 → 03
- **Team features and server:** 07 → 09 → 10
- **Retrieval / RAG:** 15 → 06 → 12
- **Connectors (Google, uploads):** 16 → 09 → 07 §4.6
- **Reviewing the idea:** 00 → 02 → 14

## One-page summary

1. Knowledge is stored as **markdown records with YAML frontmatter** in `.aimem/` inside each repo (03).
2. Eight record types; four core: `decision`, `task`, `memory`, `handoff`.
3. Agents are told (via generated `AGENTS.md`/`CLAUDE.md` blocks) to: **start** with `aimem context`, **record** findings during work, **end** with `aimem handoff` (06).
4. `aimem context` returns a ranked, budgeted **briefing** using hybrid (keyword + semantic) retrieval that also works offline; `aimem ask` answers questions with citations (06 §2, 15).
5. **Live state** (claims) prevents duplicate work: via a git branch or an optional self-hosted server (07).
6. Works for **1 repo or many** (optional hub), **solo or team**, **new or running projects** (`init` / `adopt`) (03 §7, 08).
7. A **web app** gives PM/QA/DevOps/DB/analysts role-based views and edits through PRs (10).
8. Non-developers keep working in **Google Docs/Sheets**; connectors ingest from them into externally-owned, read-only records (16).

## Conventions in these docs
- "Ref" = record reference like `dec-7k3m9q2x` (01).
- Section references like "03 §7" mean document 03, section 7.
- MUST/SHOULD are used loosely; the spec in 03 is normative where it says "Rules" or defines validation codes.
- These docs are also meant to be read by AI agents building the project; see `../AGENTS.md`.
