# 24 — M5 Web Viewer Plan

Status: **proposed, waiting for the owner's approval.** No M5 code exists yet. This plan turns the M5 entry in 13 and the local mode in 10 §2 into PRs. It builds on the PM task list (Nanda), the UX spec (Ajaw), backend constraints (Eko), the QA test plan items 20–33 (Opan) and the acceptance script (Wisnu).

M5 acceptance (13): a non-developer teammate answers three scripted questions ("why did we choose X?", "what's in QA?", "what happened in incident Y?") without help.

## Decisions to confirm before coding

1. **Server-rendered HTML instead of Next.js (changes 10 §7, 11 §1–2).** The local viewer is a new package `packages/viewer` (`@aimem/viewer`): `node:http`, HTML templates, one CSS file and one small script. It depends on `core` and `schema` only; the CLI loads it lazily. Next.js stays the choice for the team app in M6. Reason: `next` + `react` + `react-dom` install 338 MB and 10,362 files into a CLI that only needs to show files from one folder. Cost: M6 reuses the rendering rules, markdown renderer, URLs and tests, but not the page templates. *The PM list proposes Next.js in `packages/web`; that remains the alternative.*
2. **`markdown-it` instead of remark/rehype (changes 10 §7).** Measured on hostile 200 KB bodies (below): remark blocks the process for more than 20 s on two of 16 inputs; `markdown-it` needs at most 0.9 s on any. `html: false`, images rendered as a text link, links limited to `https:`, `http:`, `mailto:` and record refs. 09 T5 asks for a sanitizer as well: the renderer writes tags only from a fixed allow-list, and the CSP is the second layer.
3. **Import page (13 says "Import/upload page").** Recommended: a guide to `aimem import` and `aimem sources`, with no upload. The local mode is read-only (10 §2), and a browser upload would need a write path, CSRF protection and an author identity. Upload moves to M6.
4. **Review queue.** 22 lists a web review queue under M5; 13 lists it under M6. Recommended: 13 wins. M5 shows the unreviewed counts and a trust filter.
5. **Local access.** 127.0.0.1 only and no login (10 §2). Recommended: no `--host` option at all in M5, so the viewer cannot be exposed by mistake. Anyone logged in to the same computer can open it while it runs; the docs say so.
6. **Search is keyword search.** The viewer never loads an embedding model or calls an LLM, so its order can differ from the hybrid `aimem search`. Tests compare with core `search()`.

## What the code and measurements show

Checked on `main` `b518720`, Node 26, 4 vCPU; synthetic notebook of 5,000 memories of about 150 words. Measured once each, so treat them as orders of magnitude.

| Finding | Consequence |
|---|---|
| `loadProjectIndex` takes 1.3–1.5 s and reads every file | Cached in memory; never per request |
| `stat` of 5,000 files in parallel takes 68 ms (serial 339 ms) | Change check on every request is affordable |
| `search()` takes 190–240 ms and returns 10 hits by default | Pass an explicit limit, paginate in the viewer |
| `search()`/`filterRecords()` hide `done`, `cancelled`, `superseded`, `rejected`, `retired` | Boards and timelines pass `includeSuperseded`; search has an "Include closed" option |
| `reviewQueue()` takes 1.8 s, `summarizeNotebook()` 9 ms | Dashboard counts come from `summarizeNotebook()` without its `live` argument (no Git) |
| One file that disappears between listing and reading makes `loadIndex` reject | Retry once, then keep the last good index with a visible notice |
| A symlink in `.aimem/memory/` is followed | The viewer leaves symlinked records out and shows a problem card |
| Two local files with one id are both indexed and not reported in `duplicates` | The record page lists both instead of picking one silently |
| `aimem serve web` exits 2 with `USAGE`; `action()` runs no heartbeat, call log or refresh | `serve` stays free of automatic side effects |

Markdown, 200 KB per input, 16 inputs (time to render):

| Input | remark + sanitize | `markdown-it` |
|---|---|---|
| repeated `>` | > 20 s (stopped) | 6 ms |
| repeated `*_` | > 20 s (stopped) | 243 ms |
| repeated `[^a] ` | 15.3 s | 179 ms |
| wide table | 10.5 s | 393 ms |
| repeated `![` | 483 ms | 903 ms |

`markdown-it` drops content nested deeper than its limit (600 nested list items kept 1,148 characters), so every record page also offers the body as escaped plain text. Neither library blocks remote images or `//host` links by default; both need our own rules.

## Slice order

| Slice | Owner | Scope | Proof |
|---|---|---|---|
| 5.1 | Eko | `packages/viewer` skeleton, `aimem serve web [--port]`, request guard, index cache, plain dashboard with counts | Built CLI serves a fixture; guard and read-only tests; clear error outside a notebook or when the port is taken |
| 5.2 | Virgi | Layout, styles, record page, markdown renderer, error and not-found pages | XSS corpus checked in a parsed DOM; ref, unknown ref and path-like ref; 5 MB body |
| 5.3 | Virgi | Search page, filters, pagination, keyboard | Same hits and order as `search()`; empty and no-result states; back returns to the query |
| 5.4 | Dito | Task board and list; "Tasks in review" | Columns equal the task statuses in the schema; same set as `aimem list task --status review --json` |
| 5.5 | Dito | Decision timeline, handoff feed, browse by type (incidents) | Order and links; superseded chain; empty fixture |
| 5.6 | Virgi | Dashboard and role lens | Same set as `filterRecords({ roles })`; lens never hides search results |
| 5.7 | Dito | Source badges, **Edit at source**, import guide | Only valid `https:` source URLs become links; no write route |
| 5.8 | Opan | Playwright + axe, acceptance run | Three questions answered without help; run recorded |

5.1 → 5.2 → 5.3 are sequential. 5.4 and 5.5 need 5.2; 5.6 needs 5.3–5.5; 5.7 needs 5.2. Each slice is one PR with tests first, reviewed by someone other than its author. After 5.3 a person can find a decision and read why (checkpoint 1). Ajaw reviews the screens of 5.2–5.7.

## 5.1 — Server, guard and index cache

- `deps.serveWeb` in `bin.ts` next to `serveMcp`, imported lazily. Default port 4747, `--port 0` picks a free one. Prints the URL; does not open a browser (11 §2.1: only `core/git` and `core/process` start processes). Ctrl-C closes it.
- **Guard:** bind `127.0.0.1`; `Host` must be `localhost` or `127.0.0.1` with the actual port, otherwise 421; only GET and HEAD, otherwise 405; URL at most 2 KB; no CORS headers.
- **Headers:** `Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`. The two assets are constants in the package; no route maps a URL to a file path.
- **Cache:** signature of path, mtime and size over the record files and `project.yaml` of every source; one load at a time; on failure the last good index plus a "could not refresh" notice; 503 page when there is none.
- **Read-only:** no lock, call log, vector refresh, Git or network. A test hashes the whole `.aimem/` tree before and after requesting every route, and a static scan allows no write or process API in the package.
- URLs follow 10 §3 (`/p/:project/…`); `/` redirects to the only project.

## 5.2–5.3 — Record page and search

- Record page: title, body, then status, trust and freshness as separate text labels, `verified` date, roles, tags, paths as text, links, supersede chain, source and notebook label (`hub`, `repo:<name>`). **Copy reference** appears only when the script runs.
- Lookup by id from the index only. Moved stubs resolve as in `loadProjectIndex`; a stub whose target is not checked out says so. `[[ref]]` and record ids become links; `sourceWarnings()` and `problems` are shown as notices.
- Every value is escaped, including title, tags, author, paths and `source`. The raw file text is never served.
- Bodies above 200 KB are shown as plain text, cut at 1 MB with a note. A record that fails to render shows an error card; the rest of the page still loads.
- Search is a plain GET form that works without JavaScript; the script adds `Ctrl/⌘+K`. Query, filters and page live in the URL, so Back restores them; the selected hit is kept as a fragment so focus returns to it. Query at most 200 characters; 25 results per page.
- Every list shows trust as text, so an inferred draft cannot pass for a verified record.

## 5.4–5.7 — Lists, dashboard and sources

- Screens, wording and empty states follow Ajaw's spec (`No records yet`, `No matching records`, `Record not found`). Plain language, English only, strings in one file (10 §7).
- Desktop shows task columns, phones a grouped list. No drag, claims or live panel (M6).
- The lens is a URL parameter that filters dashboard and lists through `filterRecords({ roles })`. "Open tasks for me" needs an identity and is left for M6.
- Incidents are reached through search and browse by type; the incident explorer (10 §5.7) is not in 13's M5 list.

## 5.8 — Acceptance

- axe on every page, keyboard walk-through, visible focus, skip link, 200 % zoom, reduced motion, AA contrast in light and dark.
- Wisnu's script on one fixture notebook, with one non-developer. This needs a person the owner chooses.
- Budget on 5,000 records, in the test machine's terms: a cached page under 300 ms and a search under 600 ms, measured outside the parallel unit suite so a busy machine does not fail a merge.
- Vitest covers the HTTP behaviour on all six CI cells. Playwright runs on Ubuntu / Node 24 only (new dev dependencies `@playwright/test`, `@axe-core/playwright`).

## Expected files

| Area | Files |
|---|---|
| Viewer | `packages/viewer/src/{server,guard,cache,html,markdown,pages/*}.ts`, `packages/viewer/src/assets/*`, `packages/viewer/test/*` |
| CLI | `packages/cli/src/{bin,deps,run}.ts` |
| Workspace | `tsconfig.json`, `tsconfig.test.json`, `pnpm-lock.yaml`, CI workflow (5.8) |
| Docs | 04 (`serve web`), 09 (local viewer), 10 §2, §7, 11 §1–2, 13 (M5 status), 14 (ADR for decisions 1–2), 22 (review queue), README index |

Docs 10, 11, 13 and 14 change in slice 5.1, after approval. New runtime dependency: `markdown-it` (exact version, 3 MB with its dependencies, in `viewer` only).

## Out of scope

Login, editing, upload, review actions, live claims, Git history, `ask`, link graph, several projects at once (all M6 or later). M4/M4b acceptance with a real project and a real Google account continues separately.
