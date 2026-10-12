# 01 — Concepts and Glossary

## Core concepts

**Project** — a logical product made of one or more git repositories. Identified by a slug (`acme-platform`).

**Repo** — a git repository belonging to a project. Each repo may contain its own `.aimem/`.

**Hub** — an optional extra repo that holds knowledge that spans several repos (cross-repo decisions, tasks, handoffs). See 03 §7.

**`.aimem/`** — the folder, committed in git, that holds all records for a repo.

**Record** — one markdown file with YAML frontmatter. The unit of knowledge. Has a `type`.

**Record type** — `decision`, `task`, `memory`, `handoff` (core, v1) and `incident`, `runbook`, `schema`, `testcase` (extended).

**Ref** — a stable pointer to a record. Local: `dec-7k3m9q2x`. Global: `acme-platform:dec-7k3m9q2x`.

**Briefing (context pack)** — the compact, ranked bundle of records returned by `aimem context` for an agent about to start work.

**Handoff** — a record an agent/person writes at session end: what was done, what is not done, what is next, what is blocked.

**Claim** — live (ephemeral) statement "agent X is working on task T / paths P". Not a durable record. See 07.

**Live state** — claims, presence, heartbeats. Changes constantly; expires.

**Durable knowledge** — decisions, memories, runbooks, incidents, schema notes, test cases, handoffs. Changes rarely; reviewed.

**Supersede** — replace a record by writing a new one that points at the old one. The old one is marked `superseded`, never deleted.

**Trust level** — `verified` (a human confirmed), `agent` (written by an agent, not yet reviewed), `inferred` (derived by `aimem adopt` from existing artifacts). Affects ranking and display.

**Adapter** — a thin integration so a specific tool can use the files: generated instruction snippets (`AGENTS.md`, `CLAUDE.md`, ...), the CLI, the MCP server, the web app.

**Mode** — `solo`, `team`, `team-realtime`. Config only.

**Role** — which audience a record is most relevant to: `dev`, `pm`, `qa`, `db`, `devops`, `analyst` (extensible per project).

## Glossary of terms used in these docs

| Term | Meaning |
|------|---------|
| ADR | Architecture Decision Record. Our `decision` type is ADR-shaped |
| Frontmatter | YAML block at top of a markdown file between `---` lines |
| Source of truth | The place that wins when two copies disagree. Here: files in git |
| MCP | Model Context Protocol; a standard way for agent tools to call external tools |
| Briefing budget | Max size (tokens/characters) of an `aimem context` output |
| CAS | Compare-and-swap; an atomic "only if unchanged" update. Used for claims |
| Stale | A record whose `verified` date is older than its type's freshness window |
| Live branch | The git branch `aimem-live` holding claim files in `sync: git` mode |
| RAG | Retrieval-augmented generation: retrieve relevant knowledge, then let a model use it. In aimem, agents are the generator for briefings; `aimem ask` generates cited answers (15) |
| Chunk | A piece of a record (head chunk or a markdown section) that is embedded and searched (15 §3) |
| Embedding | A numeric vector representing the meaning of a chunk; derived data, never committed |
| Hybrid retrieval | Lexical (BM25) + semantic (vector) search fused into one ranking |
| Connector | An adapter that ingests content from an outside system (Google Drive, file upload; Odoo deferred) into records (16) |
| Externally-owned record | A record whose content is owned by an external source (`managed_by: external`); updated one-way from the source and read-only in aimem |
| Source | Where an externally-owned record comes from: system + id + url + version (`source:` frontmatter) |
| Inbox | A designated Drive folder (or the upload page) where non-developers drop documents for import |

## Naming conventions

- Record file name: `<id>-<slug>.md` e.g. `dec-7k3m9q2x-use-postgres.md`
- ID: `<prefix>-<8 chars base32 lowercase>`; prefixes: `dec`, `tsk`, `mem`, `hnd`, `inc`, `run`, `sch`, `tst`.
- Dates: ISO-8601 (`2026-10-08` or full timestamp UTC).
- Authors: `human:<handle>` or `agent:<tool>[:<model>]` (e.g. `agent:claude-code`).
