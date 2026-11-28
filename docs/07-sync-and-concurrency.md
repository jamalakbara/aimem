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
   - `.gitattributes`: `.aimem/INDEX.md merge=ours` (written by `aimem init`). Git has no built-in `ours` driver, so each clone also needs `git config merge.ours.driver true`; without it the attribute is ignored and INDEX.md conflicts when two branches add records.
   - `aimem hooks install` sets the driver and adds `post-merge`/`post-checkout`/`post-rewrite` hooks that run `aimem index`. A CI step also runs `aimem index` and checks for a diff (12 §7). `aimem doctor` reports what is missing. After a merge the hook may leave `.aimem/INDEX.md` modified in the working tree: that is the regenerated file, and committing it is expected.
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
- A task claim without explicit paths copies the task record's `paths`.
- A claim may also be **path-only** (no task) for ad-hoc work: `aimem task claim --paths "..." --note "..."`. It is stored at `claims/clm-<8 ID characters>.json` with `id` instead of `task`, and `paths` is required.
- Claim paths are repo-relative POSIX globs (04 §5 lists the limits).
- Path overlap between active claims by different holders produces a **warning**, never a block (two tasks may legitimately touch the same area). Two globs overlap when the static segments before the first wildcard segment of one equal, or are a whole-segment ancestor of, the other's. `src/api` overlaps `src/api/routes.ts` but not `src/api-v2/routes.ts`. False positives are acceptable for a warning.
- A *shared* claim (pairing) is allowed with `--share`; every holder is listed in `participants` (at most 8), each with its own `joined` and `heartbeat`. Top-level `holder` and `session` name the first participant, and `heartbeat` is the latest participant heartbeat, so expiry stays `heartbeat + ttl`: the claim is active while any participant is active. Joining, heartbeat and leaving use the same CAS as any claim edit. A heartbeat or leave retries when other participants changed the claim, as long as the claim keeps its `started` time and the caller keeps its `joined` entry; a takeover still makes it conflict. A takeover requires every participant to have expired and records each previous holder as an `Aimem-Previous-Holder` trailer.
- `live` shows a claim as "possibly abandoned" at nominal expiry. Any caller can take over five minutes after nominal expiry by passing `--steal`. The previous holder is recorded in the takeover commit and remains visible until live-branch compaction.
- `task heartbeat <ref>` extends an active claim for its owning holder and session. `aimem context` (and the MCP `aimem_context` tool) extends this session's own active claims when their heartbeat is at least 20 minutes old (or half the TTL, for TTLs under 40 minutes); it never revives an expired claim.

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
Section 4 below. Target visibility latency < 1 s (p95); slice 6.1 measures it only in a simulation (plan 6.1 §8), not yet on a LAN or the internet. The CI job `p95` (`packages/server/bench/claim-visibility.ts`) runs three profiles on one machine: same instance, two instances, and two instances behind a proxy that delays data 50 ms each way. Its best result is "passed in simulation". The job is not a required check until it has been green 5 runs in a row on the same head, and no result has been recorded yet.

### 2.4 Failure semantics
| Situation | Behaviour |
|-----------|-----------|
| Git remote down in git mode | `claim` fails with `SYNC_FAILED`; `--local` creates an **unsynced local claim** in `.aimem/.cache/claims-pending/`, marked as such, and warns. The next online claim command or `live` publishes it through the CAS. It never displaces a live claim: if another holder claimed first, or its TTL elapsed, it is dropped with a warning. Work in the checkout is untouched. |
| Server down in server mode | Same: fail, or `--local` unsynced claim. We never silently fall back to a second backend (avoids split-brain) |
| Holder crashed | Claim expires by TTL |
| Remote accepts connections but never answers | Every fetch, push and ls-remote of `aimem-live` stops after `AIMEM_LIVE_TIMEOUT_MS` (default 10 s) and reports `SYNC_FAILED`; `context`, `status` and `handoff` continue with live state marked unavailable. |
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
- Every write to a task's claim (acquire, takeover, heartbeat, release, sweeper) runs in one transaction that first takes an advisory lock keyed on `(project_id, task_ref)`, then reads the time with `clock_timestamp()` (not `now()`, which is the start of the transaction) and the open claim. A concurrent loser waits for the lock and then sees the holder → HTTP 409 `CLAIM_CONFLICT`; the unique index is the second guard.
- Expiry follows Git mode (§2.1): an expired claim **stays open** (`expired: true` in `live`). Acquire without `steal` is refused, also for its owner; `steal` succeeds from `expiresAt + 5 min` on and marks the old claim `released_status = 'taken_over'`; a heartbeat never revives it; its owner may still release it. A `steal` repeated by the owner of the active claim returns it (200) without a new event.
- Each change writes one event and one audit row in the same transaction. Event numbers are per project, from a counter row that stays locked until commit, so a later number is never visible before an earlier one. `NOTIFY` carries only `{project_id, seq}`.
- A periodic sweeper (slice 6.1b; every 15 s on each instance, at most 500 claims per run) emits `claim.expired` once per expired claim; it does not release claims. The event can therefore come about 15 s after expiry, later when more than 500 are due; `GET /live` computes `expired` when it is read. Each claim is handled in its own transaction under the same task lock and decided again with the server time read after the lock. `expired_notified_at` records the report, so instances that sweep at the same time still report once. The audit actor is `system:sweeper`. Takeover rules do not change: `steal` still waits until `expiresAt + 5 min`.
- `record_index` and `events` can be truncated and rebuilt/replayed.

### 4.4 Real-time delivery
- Server-sent events as default (simple, proxy-friendly); WebSocket optional later.
- Postgres `LISTEN/NOTIFY` fans events out across server instances; Redis only if a single node is outgrown.
- Clients (CLI `aimem live --watch`, web app) resume with `since=<last event id>`.
- `GET /projects/:slug/events` (slice 6.1b, scope `read`):
  - **Cursor:** `Last-Event-ID` wins over `?since`; with neither, only new events are sent. The answer is 400 `USAGE` before any stream starts when a cursor is not a whole number ≥ 0, is ahead of the latest event, appears twice, or comes with another query parameter. `GET /live` returns the `cursor` to start from.
  - **No gaps or repeats:** the stream registers for notifications first, then reads `seq > cursor` from the events table and drops any `seq` it already sent.
  - **Missed notifications:** a notification only wakes readers of its project. While an instance's `LISTEN` connection is down, it reads the table every second and reconnects with backoff (250 ms doubling to 5 s); then every stream catches up from the table.
  - **Access re-checks:** token, membership and `read` scope are checked again after each read from the table, after every wait for a slow reader, and at every `: ping` (15 s). When access is gone, the stream closes without sending more.
  - **Limits:** at most 256 streams per instance; the next one gets 503 `SYNC_FAILED` with `Retry-After: 5`. When 1 MB is still unsent, the server waits up to 10 s for the reader; if the reader has not caught up, the stream is cut and the client resumes with `Last-Event-ID`. A stream the server closed but whose reader takes nothing is also cut after 10 s.
  - **Response headers:** `Cache-Control: no-store` and `X-Accel-Buffering: no`. Each response names its instance in `Aimem-Instance` when the operator sets `AIMEM_INSTANCE`.
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
