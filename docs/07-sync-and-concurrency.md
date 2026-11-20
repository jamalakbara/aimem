# 07 — Sync and Concurrency

Two kinds of data, two mechanisms (ADR-002):

| | Live state | Durable knowledge |
|---|---|---|
| Examples | claims, presence, heartbeats | decisions, memories, handoffs, tasks, runbooks |
| Change rate | constant | rare |
| Review | none | PR / commit review per `write_policy` |
| Storage | `aimem-live` branch **or** sync server | `.aimem/` in the repo (git) |
| Loss tolerance | can be lost; expires | must never be lost |

## 1. Preventing file conflicts (durable)

1. **One file per record**; IDs are random so branches never collide on names.
2. **Handoffs are one file per session** and immutable by convention.
3. **No deletes.** Supersede instead; a delete/modify conflict cannot occur on normal workflows.
4. **Append-only where possible.** Notes are added as new records or linked records rather than editing shared ones.
5. **Generated files are not hand-merged.** `INDEX.md` is a generated file and a conflict magnet. Handling:
   - `.gitattributes`: `.aimem/INDEX.md merge=ours` (written by `aimem init`; `aimem doctor` checks it).
   - Git hook `post-merge`/`post-checkout` and CI step run `aimem index` to regenerate.
   - If a conflict still appears: `git checkout --theirs .aimem/INDEX.md && aimem index`.
6. **Same record edited concurrently** (rare): normal git conflict in frontmatter/body. `aimem validate --fix` restores derived fields (`updated`, back-links). Humans resolve content.

## 2. Preventing duplicate work (live)

### 2.1 Claim model
```json
{
  "task": "acme-platform:tsk-3f9a1b2c",
  "holder": "agent:claude-code",
  "on_behalf_of": "human:rina",
  "session": "01J9…",
  "paths": ["services/webhooks/**"],
  "note": "making handler idempotent",
  "started": "2026-10-08T07:02:11Z",
  "heartbeat": "2026-10-08T07:20:40Z",
  "ttl_minutes": 180
}
```
Rules:
- In Git, the claim JSON for a task is stored at `claims/<task-id>.json` with a project-qualified `task` ref inside it. `on_behalf_of`, `paths`, and `note` are optional.
- A task has **at most one** active claim. Expiry = `heartbeat + ttl`.
- A claim may also be **path-only** (no task) for ad-hoc work: `aimem task claim --paths "..." --note "..."`. It is stored at `claims/clm-<8 ID characters>.json` with `id` instead of `task`, and `paths` is required.
- Claim paths are repo-relative POSIX globs (04 §5 lists the limits).
- Path overlap between active claims by different holders produces a **warning**, never a block (two tasks may legitimately touch the same area). Two globs overlap when the static segments before the first wildcard segment of one equal, or are a whole-segment ancestor of, the other's. `src/api` overlaps `src/api/routes.ts` but not `src/api-v2/routes.ts`. False positives are acceptable for a warning.
- A *shared* claim (pairing) is allowed with `--share`; every holder is listed in `participants` (at most 8), each with its own `joined` and `heartbeat`. Top-level `holder` and `session` name the first participant, and `heartbeat` is the latest participant heartbeat, so expiry stays `heartbeat + ttl`: the claim is active while any participant is active. Joining, heartbeat and leaving use the same CAS as any claim edit. A heartbeat or leave retries when other participants changed the claim, as long as the claim keeps its `started` time and the caller keeps its `joined` entry; a takeover still makes it conflict. A takeover requires every participant to have expired and records each previous holder as an `Aimem-Previous-Holder` trailer.
- `live` shows a claim as "possibly abandoned" at nominal expiry. Any caller can take over five minutes after nominal expiry by passing `--steal`. The previous holder is recorded in the takeover commit and remains visible until live-branch compaction.
- `task heartbeat <ref>` extends an active claim for its owning holder and session. Automatic heartbeats from `context` and `handoff` are planned at 20-minute intervals during activity.

### 2.2 `sync: git` — claims on the `aimem-live` branch
- `aimem init --team --sync git` and `aimem init --upgrade --sync git` ensure `refs/heads/aimem-live` on `origin`. Setup queries that ref before writing notebook files. If the remote reports it missing, aimem creates a parentless commit with an empty tree and pushes only the live ref. After a rejected push, it checks the ref again to detect concurrent creation. An unreachable remote or missing required `origin` returns `SYNC_FAILED`. Offline setup defers the remote step.
- Setup uses the repository's object database and preserves the current branch, index and working files. Claim operations use a private, per-invocation ref and temporary index in that repository. They preserve `FETCH_HEAD` and ordinary remote-tracking refs. The live branch tree contains only `claims/<id>.json` entries, where `<id>` is a task ID or a path-only `clm-` ID.
- A claim operation reads and writes the same endpoint, using the sole effective push URL for `origin`. Claim operations require Git 2.31 or newer to configure that endpoint for each command. They check `git --version` first and return `SYNC_FAILED` with the found version on older Git. [Git 2.31 command options](https://git-scm.com/docs/git/2.31.0.html)
- **Claim algorithm (CAS via git):**
  1. Fetch `aimem-live` into a private ref and read the task entry from that tip. Ordinary acquisition returns an active claim to its owner, or `CLAIM_CONFLICT` (exit 3) if another claim occupies the path. An invalid entry yields `SYNC_FAILED`.
  2. Add, replace or delete the claim in a temporary index based on that tip. Create a commit whose sole parent is the tip, then push it to `aimem-live` with an exact-tip lease. A per-invocation operation ID in the commit trailer distinguishes otherwise identical edits. The lease rejects a changed or deleted ref.
  3. After a failed push, fetch again. Ordinary acquisition retries if the tip advanced and the path is still free. For heartbeat, release and takeover, an attempted commit in the fetched tip's ancestry confirms the operation. An absent entry also confirms release. Otherwise retry only when the target path's latest change commit is the same as initially observed. Allow up to three pushes and return `SYNC_FAILED` if the result cannot be confirmed.
  4. Remove the private ref and temporary index after each invocation.
- **Release:** the owning holder and session can remove an active or expired live claim. The durable task record is independent.
- **History noise:** each heartbeat is a commit. History of `aimem-live` is disposable; a scheduled job (or `aimem sync --compact`, maintainers only) recreates the branch from its current tree using `--force-with-lease`.
- **Latency:** `live` fetches a fresh snapshot on each invocation. Context integration is planned.
- Branch protection must allow direct pushes to `aimem-live` by team members/agents (it is separate from main).

### 2.3 `sync: server` — claims in the sync server
Section 4 below. Typical visibility latency < 1 s.

### 2.4 Failure semantics
| Situation | Behaviour |
|-----------|-----------|
| Git remote down in git mode | `claim` fails with `SYNC_FAILED`; `--local` creates an **unsynced local claim** marked as such and warns; it syncs on next success |
| Server down in server mode | Same: fail, or `--local` unsynced claim. We never silently fall back to a second backend (avoids split-brain) |
| Holder crashed | Claim expires by TTL |
| Clock skew | Git compares its local clock to `heartbeat + ttl`. Takeover opens five minutes after nominal expiry because Git commit times are client-supplied. |
| Two sessions both `--steal` | CAS decides. The loser gets `CLAIM_CONFLICT`. |

## 3. Duplicate knowledge (not just duplicate work)

Even with claims, two sessions may record the same fact. Layers of defence:
1. **At write time:** `add` runs a similarity search (title/summary BM25 + tag/paths overlap); likely duplicates → exit 3 `DUPLICATE_LIKELY`.
2. **At validate time:** V011 flags overlapping accepted decisions; a similar check flags near-duplicate memories (same `paths` + high text similarity).
3. **At review time:** reviewers `supersede` one record with the other or merge text.
4. **In the web app:** "possible duplicates" list.

## 4. Sync server (optional, self-hosted)

### 4.1 Responsibilities
- Live state: claims, sessions/presence, event stream.
- Repo index: clone configured repos (read-only credentials), index `.aimem/` for fast search and the web UI. Re-index on push webhook or poll.
- Auth for web users and agent tokens.
- Not responsible for storing durable records (git is).

### 4.2 API (REST + SSE), version prefix `/v1`
| Method & path | Purpose |
|---------------|---------|
| `GET /projects/:slug` | Project summary + config |
| `GET /projects/:slug/records?type=&status=&q=&role=&tag=&repo=&mode=lexical\|hybrid` | Search/list indexed records (hybrid uses the server's embeddings) |
| `POST /projects/:slug/ask` | RAG answer with citations (needs LLM provider configured; rate-limited) |
| `POST /projects/:slug/imports` | Upload a file (multipart) → import report (16 §7) |
| `GET/POST /projects/:slug/sources`, `POST …/sources/:id/sync` | Manage connected sources, trigger a sync (admin) |
| `GET /projects/:slug/records/:ref` | One record (from index) |
| `GET /projects/:slug/live` | Active claims + sessions |
| `POST /projects/:slug/claims` | Acquire claim (atomic) → 201 or 409 with holder |
| `PUT /projects/:slug/claims/:id/heartbeat` | Extend TTL |
| `DELETE /projects/:slug/claims/:id` | Release (body: final status) |
| `POST /projects/:slug/sessions` / `DELETE …/:id` | Register / end a session |
| `GET /projects/:slug/events?since=<id>` | SSE stream: `claim.created`, `claim.released`, `claim.expired`, `record.indexed`, `session.started`, … |
| `POST /projects/:slug/webhooks/git` | Git host push webhook (HMAC-verified) |
| `POST /projects/:slug/pr` | Web edit → create branch + PR (see 10) |
| `POST /tokens` / `DELETE /tokens/:id` | Manage tokens (admin) |

All writes accept `Idempotency-Key`. Errors: RFC 7807 problem+json with the stable codes of 04 §7.

### 4.3 Data model (PostgreSQL)
```
projects(id, slug unique, name, config jsonb, created_at)
users(id, handle unique, email, github_id, created_at)
memberships(project_id, user_id, roles text[], is_admin bool)
tokens(id, project_id, user_id null, kind 'human'|'agent', name, hash, scopes text[],
       created_at, last_used_at, revoked_at)
repos(id, project_id, name, url, default_branch, head_sha, last_indexed_at)
record_index(project_id, repo_id, ref, type, status, trust, title, summary, roles text[],
             tags text[], paths text[], author, created, updated, verified,
             file_path, body_sha, fts tsvector)        -- rebuilt from git; disposable
record_chunks(project_id, repo_id, ref, section, chunk_idx, text, body_sha, model_id,
              embedding vector(N))                        -- pgvector; derived, rebuilt from git (15 §5)
sources(id, project_id, type, config jsonb, secret_ref, enabled, last_run_at, last_status)   -- 16
source_runs(id, source_id, started_at, finished_at, status, stats jsonb, error)               -- audit of every sync
sessions(id, project_id, holder, on_behalf_of, tool, started_at, last_seen_at, ended_at)
claims(id, project_id, task_ref null, holder, on_behalf_of, session_id, paths text[], note,
       started_at, heartbeat_at, expires_at, released_at, release_status)
events(id bigserial, project_id, type, payload jsonb, at)
audit_log(id, project_id, actor, action, target, at, meta jsonb)
```
Constraints:
- Partial unique index `claims(project_id, task_ref) WHERE released_at IS NULL` guarantees one open claim per task. (Postgres cannot use `now()` in an index predicate, so expiry is handled in code.)
- Acquire runs in one transaction: take an advisory lock keyed on `(project_id, task_ref)`; mark any open claim with `expires_at < now()` as released (`release_status = 'expired'`); then insert the new claim. A concurrent loser gets a unique-violation or sees the live holder → HTTP 409.
- A periodic sweeper also releases expired claims and emits `claim.expired` events.
- `record_index` and `events` can be truncated and rebuilt/replayed.

### 4.4 Real-time delivery
- Server-sent events as default (simple, proxy-friendly); WebSocket optional later.
- Postgres `LISTEN/NOTIFY` fans events out across server instances; Redis only if a single node is outgrown.
- Clients (CLI `aimem live --watch`, web app) resume with `since=<last event id>`.
- Agents do not hold open streams; they poll `GET /live` inside `context` (cheap) — streaming is for dashboards.

### 4.5 Deployment (self-hosted)
- One container (Node) + Postgres (with the `pgvector` extension for semantic search). Reverse proxy with TLS. Env: `DATABASE_URL`, `AIMEM_SECRET`, `GIT_CREDENTIALS` (deploy key/GitHub App), `PUBLIC_URL`.
- Back up Postgres for tokens/memberships/audit; claims/events are disposable.
- Observability: structured logs, `/healthz`, `/metrics` (Prometheus).

### 4.6 Connector workers
- A scheduler runs each enabled source every `poll_minutes`; one run per source at a time (advisory lock). Results go to `source_runs`.
- Writes to git use a bot identity (`aimem-bot`) with an `On-Behalf-Of: <importer>` commit trailer, via direct commit or PR per `write_policy`.
- **Placement:** workers must be able to reach the sources. If a source is only reachable on a private network/VPN, the server runs inside that network (the deferred Odoo case is discussed in 16 §6.3).
- Credentials come from the secret store; failures raise `SOURCE_AUTH` / `SOURCE_UNREACHABLE` alerts in the web app.

## 5. Offline and degraded behaviour summary

| Capability | Online (server) | Online (git) | Offline |
|------------|-----------------|--------------|---------|
| Read records | yes | yes | yes (local) |
| Briefing | yes + live | yes + live (fetch) | yes, without live; warns |
| Claim | atomic | atomic via CAS | local unsynced only |
| Add/update records | yes | yes | yes (local commit) |
| Web app | yes | via server only | n/a |
