# 11 — Tech Stack and Repository Layout

> Choices here are **proposed defaults** (ADR-003). Change them early or not at all; the file format (03) is the real contract and is language-independent.

## 1. Stack

| Concern | Choice | Why | Alternative |
|---------|--------|-----|-------------|
| Language | TypeScript (strict) | One language across core, CLI, MCP, server, web; official MCP TS SDK; schema shared with web | Go for CLI/core (single static binary) — see OQ-2 |
| Runtime | Node.js current LTS | Ubiquitous; agents/devs already have it | Bun later for single-file binaries |
| Package manager / monorepo | pnpm workspaces + Turborepo (or plain pnpm scripts) | Fast, simple | npm workspaces |
| Schema / validation | Zod → JSON Schema export | Single source for types, validation, JSON Schema | Valibot, TypeBox |
| Markdown / frontmatter | `yaml` + own splitter (or `gray-matter`), `unified`/`remark` for rendering | Preserve unknown keys and key order on rewrite | |
| Lexical search | Own in-memory BM25 over boosted fields (~80 lines; no stemming, accent folding); no cache yet (5k records index + search ≈ 0.5 s) | No dependency; deterministic; any language | MiniSearch (typo tolerance), SQLite FTS5 if scale demands |
| Embeddings (client) | Local in-process multilingual model (ONNX/transformers-style, WASM/JS preferred); optional OpenAI-compatible endpoint | Offline and private by default; team writes English + Indonesian (15 §4) | Remote-only embeddings |
| Vector search (client) | Flat cosine over float32 cache | Simple and fast at this scale | HNSW library beyond ~100k chunks |
| Vector search (server) | Postgres + `pgvector` | Reuses the existing DB; no new infra | Dedicated vector DB (rejected) |
| Document conversion | `mammoth` (docx → HTML → markdown), optional `pandoc`; xlsx/csv parser; PDF text extraction library | Pure-JS where possible | pandoc only |
| Google | Official Google API client (Drive, Sheets), service account | Official and typed | |
| Odoo (deferred) | Own thin `OdooClient` over HTTP with `json2` and `legacy` transports (16 §6.1) | Version tolerance; few dependencies. Not built in v1 | Community RPC libraries |
| Git | Shell out to the `git` binary via `execa` | Behaviour identical to the user's git; no re-implementation | `isomorphic-git` (rejected: gaps) |
| CLI framework | `commander` or `cleye`; prompts via `@clack/prompts` | Small, typed | `oclif` |
| MCP | `@modelcontextprotocol/sdk` | Official | |
| Server | Fastify (or Hono) + Postgres (`pg`) + Drizzle ORM migrations | Light, fast, familiar | Go service |
| Realtime | SSE; Postgres LISTEN/NOTIFY | No extra infra | Redis pub/sub when scaling |
| Web | Next.js (App Router), Tailwind, Radix/shadcn | Fast to build, accessible | Vite + React Router |
| Auth | GitHub OAuth via Auth.js (or minimal custom) | Team is on GitHub | |
| Tests | Vitest; Playwright for web; `testcontainers` for Postgres | | |
| Lint/format | Biome (or ESLint + Prettier) | One fast tool | |
| Build | `tsup` for packages; Next.js for web; Docker for server | | |
| CI | GitHub Actions | | |
| Release | Changesets; npm publish with provenance | | |

### 1.1 Why not a database-first design?
Because ADR-001: files in git are the source of truth. The server DB is an index plus ephemeral live state and can be rebuilt.

### 1.2 Why shell out to git?
Credentials, hooks, config, LFS, and worktree behaviour all match what the developer already uses. Cost: git must be installed (already true for every target user).

## 2. Monorepo layout

```
aimem/
  AGENTS.md                 # instructions for AI agents building this repo
  README.md
  docs/                     # these documents
  packages/
    schema/                 # @aimem/schema   Zod schemas, JSON Schema, types
    core/                   # @aimem/core     parse/validate/index/search/context/git/claims
    adapters/               # @aimem/adapters templates + generators for AGENTS.md etc.
    connectors/             # @aimem/connectors  Google Drive/Sheets, upload converters (Odoo deferred)
    cli/                    # aimem           binary entrypoint, commands
    mcp/                    # @aimem/mcp      MCP server
    server/                 # @aimem/server   REST+SSE, Postgres, indexer, auth
    web/                    # @aimem/web      Next.js app
  fixtures/
    projects/               # sample .aimem/ trees (small, medium, multi-repo, adopt-me)
    remotes/                # scripts to create bare git remotes for concurrency tests
    evals/                  # question → expected records for briefing quality
  scripts/                  # dev scripts, release helpers
  .aimem/                   # this repo dogfoods aimem from M2 onward
  .github/workflows/
  pnpm-workspace.yaml
  tsconfig.base.json
  biome.json
```

### 2.1 Package dependency rules
```
schema  ←  core  ←  adapters
              ↑        ↑
              ├──── cli ┘
              ├──── mcp
              └──── server  ←  web (via HTTP + schema types only)
```
- `schema` has no runtime dependencies except `zod`.
- `core` must not import from `cli`, `mcp`, `server`, or `web`.
- `connectors` depends on `core` only; it never imports `server`. The server and CLI call into it.
- `web` never imports server code; it talks HTTP.
- Only `core/git` spawns processes.

## 3. `@aimem/core` module map

| Module | Responsibility |
|--------|---------------|
| `records/` | read, write, serialize records; preserve unknown keys; ID/slug generation |
| `project/` | load `project.yaml`, resolve hub/sibling sources |
| `validate/` | rules V001–V018; `--fix` |
| `index/` | build in-memory index; cache load/save |
| `search/` | BM25, filters, dedupe similarity |
| `embed/` | chunking, embedding providers, vector cache/store (15 §3–§5) |
| `retrieval/` | hybrid fusion, graph expansion, optional rerank, `ask` pipeline (15 §6–§10) |
| `context/` | scoring, pinning, packing, rendering (06 §2) |
| `claims/` | claim model; backends: `git`, `server`, `local` (interface `ClaimStore`) |
| `git/` | fetch/push/worktree helpers, live-branch CAS |
| `secrets/` | scanner |
| `adopt/` | extractors and candidate generation |
| `ingest/` | import pipeline: normalise → map (templates/extraction) → scan → write; idempotency by `source` (16 §3) |
| `render/` | `INDEX.md`, briefing markdown/JSON |

Key interfaces:
```ts
interface ClaimStore {
  acquire(req: ClaimRequest): Promise<Claim>;          // throws ClaimConflict
  heartbeat(id: string): Promise<Claim>;
  release(id: string, status?: TaskStatus): Promise<void>;
  list(): Promise<Claim[]>;
}
interface RecordStore {
  list(filter?: Filter): Promise<RecordMeta[]>;
  get(ref: Ref): Promise<Record>;
  create(input: NewRecord): Promise<Ref>;
  update(ref: Ref, patch: Patch): Promise<Record>;
}
```
All side effects (fs, git, network, clock, random) are injected for testing.

## 4. Conventions

- TypeScript `strict`, no `any` in public APIs; exhaustive `switch` on record types.
- Errors: typed `AimemError` with stable `code` (04 §7); CLI maps codes to exit codes.
- Logging: structured; `stderr` only in CLI so `--json` stdout stays clean.
- Time: UTC ISO strings; inject a `Clock`.
- File I/O: write via temp file + rename (atomic); never leave partial records.
- Commits to this repo: Conventional Commits; PRs require passing CI.
- Branches: `main` protected; short-lived feature branches.

## 5. Local development

```
# prerequisites: git, Node LTS, pnpm, Docker (for server tests)
pnpm install
pnpm -r build
pnpm test                       # unit + integration (core, cli, mcp)
pnpm --filter @aimem/server dev # server with local Postgres via docker compose
pnpm --filter @aimem/web dev
node packages/cli/dist/index.js --help
```
Dogfooding: from M2, run `aimem init` in this repo and use it while building.

## 6. CI pipeline (GitHub Actions)
1. Install, lint, typecheck.
2. Unit tests (core/schema/adapters) — matrix: Linux + macOS, Node LTS and previous LTS.
3. Integration: CLI against temp repos; concurrency tests with bare remotes; MCP tests.
4. Server tests with Postgres service container.
5. Web build + Playwright smoke tests.
6. `aimem validate --strict` on `fixtures/` and on this repo's own `.aimem/`.
7. Release job (tags): changesets version, npm publish with provenance, Docker image push.

## 7. Distribution
- `npm i -g aimem` (verify package-name availability early; fallback scope `@<org>/aimem`).
- `npx aimem init` for zero-install trial.
- Later: single-file executables (Bun/pkg), Homebrew tap.
- Server: Docker image + `docker-compose.yml` example.
