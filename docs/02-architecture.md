# 02 — Architecture

## 1. Principles

1. **Files first.** Everything durable is a markdown file in git.
2. **Adapters on top.** CLI, MCP, web, and server all read/write the same files through one core library.
3. **Works offline, degrades gracefully.** Server down → git-only. Git remote down → local files.
4. **Graceful retrieval.** Hybrid lexical + semantic retrieval when an embedding model is available (local by default); lexical-only otherwise. Validation never needs a network or an LLM.
5. **Two speeds.** Live state and durable knowledge are stored and reviewed differently.
6. **Optional everything above the files.** Each layer can be skipped.
7. **One owner per record.** A record is owned either by the notebook or by an external source, never both (16 §2).

## 2. Layers

```
                 Humans                                   Agents
        (PM, QA, DevOps, Dev ...)               (Claude Code, Cursor, Codex ...)
                 │                                          │
           ┌─────▼─────┐         ┌──────────────┐     ┌─────▼──────┐   ┌──────────────┐
           │ Web app   │         │ Instruction  │     │ MCP server │   │ CLI (shell)  │
           │ (viewer/  │         │ files        │     │ (stdio/    │   │ aimem ...    │
           │  editor)  │         │ AGENTS.md... │     │  http)     │   │              │
           └─────┬─────┘         └──────┬───────┘     └─────┬──────┘   └──────┬───────┘
                 │ HTTP                 │ read                │ calls            │ calls
                 │                      ▼                     ▼                  ▼
                 │             ┌─────────────────────────────────────────────────────┐
                 │             │                    @aimem/core                      │
                 │             │ parse • validate • index • search • context • git   │
                 │             └──────────────┬───────────────────────┬──────────────┘
                 │                            │                       │
         ┌───────▼────────┐          ┌────────▼────────┐     ┌────────▼─────────┐
         │ Sync server    │◄─────────┤ .aimem/ files   │     │ aimem-live branch│
         │ (optional)     │ index    │ (durable, git)  │     │ (claims, git mode)│
         │ live state +   │          └─────────────────┘     └──────────────────┘
         │ repo index     │
         └────────────────┘
```

## 3. Components

| Component | Package | Responsibility | Required? |
|-----------|---------|----------------|-----------|
| Core library | `@aimem/core` | Parse/serialize records, schema validation, ID generation, index + hybrid search (15), context ranking/packing, git operations, project/hub resolution | Yes |
| Schema | `@aimem/schema` | Zod schemas + generated JSON Schema + TS types for records and `project.yaml` | Yes |
| CLI | `aimem` | Human + agent command surface; shells to core | Yes |
| Adapters | `@aimem/adapters` | Templates and generators for `AGENTS.md`, `CLAUDE.md`, Cursor rules, Copilot instructions | Yes |
| MCP server | `@aimem/mcp` | Exposes core as MCP tools/resources over stdio (and HTTP in server mode) | Recommended |
| Sync server | `@aimem/server` | Live claims, presence, event stream, repo indexing, semantic index (pgvector), ask API, auth, web API | Optional |
| Connectors | `@aimem/connectors` | Ingest from Google Drive/Docs/Sheets and file uploads into records; Odoo deferred (16) | Optional |
| Web app | `@aimem/web` | Role-based views, search, timeline, edit-via-PR | Optional |

## 4. Data flows

### 4.1 Session start (agent)
1. Agent reads `AGENTS.md`/`CLAUDE.md` block → learns the protocol.
2. Agent runs `aimem context --task "<text>" [--paths ...]` (or MCP `aimem_context`).
3. Core: resolve project (local `.aimem/` + hub if configured) → `git fetch` (if allowed) → build in-memory index → fetch live state (server, else `aimem-live` branch) → rank → pack within budget → print.
4. Agent optionally claims a task: `aimem task claim <ref>`.

### 4.2 During work
`aimem add <type> ...` writes a new record file, validates it, optionally stages/commits per `write_policy`.

### 4.3 Session end
`aimem handoff` writes a handoff record, releases claims, commits per policy.

### 4.4 Human via web
Web reads server's repo index → user edits → server opens a PR (durable) or writes live state (claims).

### 4.5 Review
Durable records authored by agents arrive as normal commits/PRs. Reviewers can mark them `trust: verified` (`aimem verify <ref>`).

### 4.6 Ingest from Google or uploads
A connector fetches the source, maps it to records (template or extraction), scans it, writes it as externally-owned records, and commits or opens a PR for review. Non-developers never touch git. See 16.

## 5. Storage layout (per repo)

```
.aimem/
  INDEX.md               # generated; agent entry point (do not hand-edit)
  project.yaml           # project manifest (see 03 §6)
  decisions/             # dec-*.md
  tasks/                 # tsk-*.md
  memory/                # mem-*.md
  handoffs/              # hnd-*.md  (immutable)
  incidents/             # inc-*.md        (extended)
  runbooks/              # run-*.md        (extended)
  schema/                # sch-*.md        (extended; DB/data notes)
  tests/                 # tst-*.md        (extended)
  .cache/                # gitignored: lexical index + vector cache (derived, rebuildable)
```
Live branch (`sync: git`): orphan branch `aimem-live` containing `claims/<task-ref>.json`.

## 6. Sync strategies

| Strategy | `sync:` value | Live state lives in | Latency | Infra |
|----------|---------------|---------------------|---------|-------|
| Local only | `none` | nothing | n/a | none |
| Git | `git` | `aimem-live` branch | seconds–minutes | none |
| Server | `server` | server DB, pushed over SSE/WebSocket | sub-second | 1 service |

Durable records always go through git regardless of strategy.

## 7. Multi-repo resolution

Order of lookup for a ref or search: (1) current repo `.aimem/`, (2) hub (if `hub:` set and available), (3) sibling repos listed in `repos:` that are checked out beside or cloned in cache. Missing sources are reported, never fatal. Details: 03 §7.

## 8. Failure modes

| Failure | Behaviour |
|---------|-----------|
| Server unreachable | Fall back to git live branch; warn once |
| Git remote unreachable | Use local clone state; warn "state may be stale" |
| Corrupt/invalid record | Skipped in briefing, reported by `validate`/`doctor` |
| Claim holder crashed | Claim expires after TTL; shown as "possibly abandoned" |
| Two claims race | Exactly one wins (CAS); loser gets a clear error |
| Index cache stale | Rebuilt automatically from files (cache is disposable) |

## 9. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Performance | `context` < 2 s for 500 records (warm), < 5 s cold |
| Size | Briefing default budget 4,000 tokens, configurable |
| Portability | macOS, Linux; Windows best-effort in v1 |
| Offline | All read paths and local writes work offline |
| Determinism | Same files + same query + same index/model version → same briefing (excluding live state) |
| Compatibility | Schema versioned (`aimem: 1`); CLI refuses to write to newer major versions |
