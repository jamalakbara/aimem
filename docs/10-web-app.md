# 10 — Web App (Viewer and Light Editor)

The web app exists for people who do not live in git or the terminal (PM, QA, DevOps, DB, error analysts) and for everyone who wants a cross-repo, searchable, live view. It is **optional**; the notebook is fully usable without it.

## 1. Principles
1. **Reads the same files.** Data comes from the server's index of the git repos. The app has no private data store for knowledge.
2. **Edits become commits/PRs.** Non-developers never touch git; the app does it for them using their identity.
3. **Role lenses, not role walls.** Views are filters for relevance (see 09 §5 on access).
4. **Plain-language UI.** No git terms in the UI ("proposed change", not "pull request"), though links to the PR are available.
5. **Fast and readable.** Records render as clean documents; keyboard-first search.

## 2. Modes
| Mode | Requires | Capabilities |
|------|----------|--------------|
| Local viewer | `aimem serve web` | Read-only view of the working tree; no auth; single user |
| Team app | Sync server | Multi-project, multi-repo, auth, live panel, edit-via-PR, review queue |

## 3. Information architecture

```
/                       Project switcher → Dashboard
/p/:project             Dashboard (role lens selector)
/p/:project/search      Global search (also Cmd/Ctrl-K)
/p/:project/ask         Ask the notebook: answers with citations (15 §10)
/p/:project/import      Upload or link documents; import results (16)
/p/:project/sources     Connected sources and sync history (admin)
/p/:project/records     Browse by type, filters
/p/:project/r/:ref      Record page
/p/:project/tasks       Task board and list
/p/:project/decisions   Decision timeline
/p/:project/live        Who is working on what (live)
/p/:project/handoffs    Handoff feed
/p/:project/incidents   Incident explorer
/p/:project/review      Review queue (agent drafts, inferred, stale)
/p/:project/graph       Link graph (later)
/p/:project/settings    Members, roles, repos, tokens (admin)
```

## 4. Role lenses (default landing + emphasis)

| Role | Landing view shows | Key actions |
|------|--------------------|-------------|
| Developer | Open tasks for me, latest handoffs for my paths, decisions touching paths I changed | Claim task, add memory, search |
| Project manager | Task board by status/priority; blocked items; decision timeline; handoff feed; review debt | Create/prioritise tasks, accept/propose decisions, read handoffs |
| QA | Tasks in `review`; testcases by status; "Next/Blocked" extracted from handoffs; linked incidents | Create testcase, mark pass/fail, open bug as `incident` or task |
| Database engineer | `schema` records, decisions tagged `database`, memories on migrations; stale schema notes | Add schema note, link to migrations |
| DevOps | Runbooks (with `last_tested` age), active incidents, deploy-related memories | Test/verify runbook, open incident |
| Error analyst | Incident explorer: filter by service/root-cause category/severity, recurrence grouping, timeline | Write postmortem, link incidents, tag root cause |

A user can belong to several roles and switch lenses; members' default lens comes from `project.yaml`.

## 5. Key screens

### 5.1 Dashboard (wireframe)
```
┌─────────────────────────────────────────────────────────────────────┐
│ acme-platform ▾          [ Search… ⌘K ]        Lens: Dev ▾   Rina ▾ │
├───────────────────────────────┬─────────────────────────────────────┤
│ LIVE NOW                      │ NEEDS REVIEW (7)                    │
│ ● rina + claude-code          │ ◐ 3 agent records                   │
│   tsk-3f9a Webhook idempotent │ ◌ 4 inferred drafts                 │
│   services/webhooks/**  18m   │ ⚠ 2 stale memories                  │
│ ● budi + cursor  tsk-77c1 …   │                                     │
├───────────────────────────────┴─────────────────────────────────────┤
│ LATEST HANDOFFS                                                     │
│ Oct 7 rina — Done: idempotent handler · Next: retry tests           │
│ Oct 6 budi — Done: ledger migration · Blocked: staging DB           │
├─────────────────────────────────────────────────────────────────────┤
│ RECENT DECISIONS            │ OPEN TASKS (mine)                     │
│ dec-7k3m Use Postgres  ✓    │ p1 tsk-3f9a …   p2 tsk-12bd …         │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Record page
- Title, status chip, trust chip (`verified` / `agent` / `inferred`), freshness (verified date), roles, tags.
- Rendered body; "relations" panel (links, supersedes chain, linked tasks/incidents).
- Code paths related (links to repo files at the current commit).
- History from git (who changed what, when) and link to the PR.
- Actions: Propose edit, Verify (humans), Supersede, Copy ref, Copy for agent (`aimem show <ref>`).

### 5.3 Editor
> Non-developers do not edit records in the app: they upload or link documents (16). The editor below is for notebook-owned records authored by developers/PMs. Externally-owned records show **Edit at source** and **Sync now** instead.
- Form per record type generated from the schema (title, summary, status, roles, tags, paths, links) + markdown body with preview.
- Validation inline (same rules as `aimem validate`, shared via `@aimem/core` compiled for the browser/server).
- Save → "Propose change": creates branch `aimem/web/<handle>/<ref>`, commits, opens PR. Policy option: direct commit to default branch for `solo` or low-risk types (memory/handoff).

### 5.4 Review queue
Tabs: Agent-written (unreviewed), Inferred (from adopt), Stale, Possible duplicates, Conflicts (V011). Each item: diff-style preview, Verify / Edit / Supersede / Discard (if allowed), bulk verify.

### 5.5 Task board
Columns by status; cards show priority, roles, live claim indicator (who/when), linked decisions. Drag to change status writes a commit (debounced) or a live status depending on policy.

### 5.6 Live
Realtime list of claims and sessions, path-overlap warnings, stale claims with "possibly abandoned" and a Release button for admins.

### 5.7 Incident explorer (analyst)
Filter/pivot by service, severity, root-cause category, month; grouped recurrences (same `services` + similar root cause); link to related decisions/runbooks.

## 6. Auth and permissions
- Login: GitHub OAuth for developers; **Google sign-in (or email link) for non-developers**, so a GitHub account is never required. Imports and web actions are committed by a bot identity with an `On-Behalf-Of` trailer.
- Membership and roles from the server DB, seeded from `project.yaml.members`.
- Server roles: admin / member / viewer.
- Web edits use the signed-in user's OAuth token to create commits/PRs (so authorship is real). If the token lacks write access, the server uses a bot identity and records `on_behalf_of` in the commit trailer.
- Session cookies: HttpOnly, SameSite=Lax, CSRF token on mutations.

## 7. Technical design
- **Framework:** Next.js (App Router) + TypeScript + Tailwind; component primitives from an accessible library (e.g. Radix/shadcn).
- **Data:** server components call the sync server REST API; client components subscribe to SSE for live panels.
- **Shared code:** `@aimem/schema` and `@aimem/core` (browser-safe subset: parse, validate, render summaries).
- **Search:** server-side Postgres FTS via `/records?q=`; client does instant filtering of already-loaded lists.
- **Markdown:** `remark`/`rehype` pipeline, raw HTML disabled, sanitized, code highlighting, relative-link rewriting to repo permalinks, `[[ref]]` autolinks.
- **Accessibility:** WCAG 2.1 AA target; keyboard navigation; status never conveyed by colour alone.
- **Responsive:** desktop-first, usable on tablet/phone for reading.
- **i18n:** English only in v1; strings centralised.

## 8. Non-goals (web, v1)
Real-time collaborative editing of a record; editing externally-owned records (edit at the source); comments/threads (use PR comments); notifications beyond a simple email/Slack webhook on review requests (post-v1); public sharing.

## 9. Acceptance criteria (v1)
- A PM with no git knowledge can: find the decision about X, see why, create a task, and see its claim status.
- A QA user can list everything in `review`, open linked testcases, and record a result.
- Any edit produces a reviewable PR whose diff is a clean markdown change.
- The live panel reflects a claim within 2 seconds on a typical network.
