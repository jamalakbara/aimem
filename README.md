# aimem

A shared, versioned project notebook for humans and AI agents. Decisions, gotchas, tasks and session handoffs live as small markdown records in `.aimem/`, committed with your code. An agent starts each session with a short, relevant briefing and ends it with a handoff, so the next session — human or agent, any tool — doesn't start blind.

> **Status:** pre-release (v0.x). Not on npm yet; install from source. Local notebooks, retrieval, MCP and Git-based team coordination work today. A web app and a sync server are on the [roadmap](docs/13-roadmap-and-milestones.md) and are not available yet.

## What you can do with it

- **Keep project knowledge in git.** Record decisions, gotchas, incidents, runbooks and tasks as markdown. Search them, update them, and supersede them without losing history.
- **Brief an agent in seconds.** `aimem context` builds a ranked briefing for the task at hand. It works offline; semantic search is optional.
- **Hand work over.** `aimem handoff` records what is done, what is not, and what comes next.
- **Coordinate a team through git.** Claim tasks, see who is working on what, get overlap warnings, and require a second person to verify durable records.
- **Start from what you already have.** Draft records from an existing repository (`aimem adopt`), or import documents and sheets (`.md`, `.txt`, `.csv`, `.xlsx`, `.docx`, `.pdf`, and Google Docs/Sheets).
- **Use it from any agent.** Through instructions in `AGENTS.md`, the CLI, or an MCP server.

## Install

Requires Node ≥ 22, pnpm and git.

```bash
git clone https://github.com/jamalakbara/aimem.git && cd aimem
pnpm install && pnpm build
cd packages/cli && npm link        # puts `aimem` on your PATH (undo: npm unlink -g aimem)
aimem --version
```

After pulling new changes, run `pnpm build` again. `aimem doctor` warns when your build is older than the source.

## Quick start

Run these inside your project (a git repository):

```bash
aimem init                         # creates .aimem/ and adds the agent protocol to AGENTS.md
aimem doctor                       # shows what is set up and what, if anything, leaves your machine
```

`init` also prints a few intake questions (what the project is, how to run and test it, conventions). Answer them by adding records:

```bash
aimem remember --title "Project overview" --summary "One-line description of the project." \
  --body "Who uses it and what success looks like."
```

Records are plain files under `.aimem/`. Records you write as a human are saved to disk and left for you to commit (`git add .aimem && git commit`).

## Daily workflow

### 1. Start a session

```bash
aimem context --task "fix webhook retries"
```

The briefing lists the records most relevant to the task, labelled by trust level (`verified`, `agent`, `inferred`). Add `--paths "services/webhooks/**"` or `--role dev` to focus it, `--explain` to see why each record was picked, and `--budget <tokens>` to resize it.

### 2. Look things up

```bash
aimem search "webhook retry"       # keyword search; hybrid when semantic search is set up
aimem list decision                # list records by type (also: --status, --trust, --tag, --stale)
aimem show <ref>                   # print one record
aimem status                       # counts, open p0/p1 tasks, claims, items waiting for review
```

### 3. Record what a future session would have to rediscover

```bash
aimem remember --title "Webhook retries after 30s" \
  --summary "The provider retries delivery after 30s; handlers must be idempotent." \
  --body "Retries reuse the same event id."
aimem decide   --title "Use Postgres for the ledger" --summary "Chosen for transactional guarantees." --body "…"
aimem incident --title "…" --summary "…" --body "…"
aimem runbook  --title "…" --summary "…" --body "…"
```

- Search first. aimem refuses a likely duplicate (exit code 3) unless you pass `--force`.
- Records that look like they contain secrets are refused. Never record secrets or personal data.
- `--body -` reads the body from stdin, and `--body-file <path>` reads it from a file.

To change or retire a record:

```bash
aimem update <ref> --set status=done      # edit fields; --body / --body-file replace the body
aimem supersede <old-ref> --by <new-ref>  # replace a record and keep both
aimem verify <ref>                        # mark a record as confirmed by a human
```

Records are normally superseded, not deleted. The one exception is `aimem discard <ref>` (see [Start from an existing project](#start-from-an-existing-project-or-documents)): it removes a record that was never verified and that nothing links to. Don't edit `.aimem/INDEX.md` by hand; it is regenerated.

### 4. End the session

```bash
aimem handoff --done "Made handlers idempotent" --not-done "Replay tests" --next "Add replay tests"
```

`--blocked` and `--notes` are optional. In a team notebook, `handoff` also releases the claims held by this session.

### 5. Keep the notebook healthy

```bash
aimem validate --strict            # check records against the rules; a good CI gate
aimem index                        # regenerate INDEX.md
aimem doctor                       # environment, adapters, search status, outbound data
```

### Optional: semantic search

```bash
aimem index --embeddings           # downloads a ~118 MB local model once, then builds a vector cache
```

Without it, `context` and `search` use keyword search and say so in their output. The model runs locally; nothing is sent to a remote service. When a vector cache exists, a CLI write returns first and refreshes the cache in a background process; set `AIMEM_EMBED_SYNC=1` to refresh inside the write instead. `aimem ask "<question>"` answers from the notebook with citations, but only after you configure `retrieval.llm` (see [docs/15](docs/15-retrieval-and-rag.md)).

## Start from an existing project or documents

### Adopt an existing repository

`aimem adopt` reads a project that already exists and drafts records from it. Run it after `aimem init`:

```bash
aimem adopt --dry-run              # list the candidates and where each comes from; writes nothing
aimem adopt                        # write them as drafts (at most 40 per run; run again for the rest)
aimem review                       # walk the drafts and other records that need a person
```

- It reads ADRs, agent instruction files (`CLAUDE.md`, `AGENTS.md`, Cursor and Copilot rules), the README and `docs/`, build and CI files, SQL migrations and git history. Pull requests (`--sources prs`, uses `gh`) are opt-in. Otherwise it is offline, never follows symlinks, and drops any passage that looks like a secret.
- Every draft is `trust: inferred`, tagged `adopted`, and carries its `evidence` (the source file). Nothing is `verified` until a person runs `aimem verify`. Running `adopt` again does not duplicate a draft; if the source changed, it is reported as "source changed" and the existing record is left alone.
- `aimem review` lists the queue: inferred drafts first, then unreviewed agent records, stale records and likely duplicates. In a terminal you can verify, edit and verify, skip or discard each item; with `--json` or without a terminal it only prints the queue. Verifying and discarding are for humans only.
- `aimem discard <ref>` deletes a record, but only if it was never verified and nothing links to it. Anything else is superseded instead. Imported records can't be discarded (`aimem detach` them first). The deletion stays recoverable from git, so commit it. A discarded draft is remembered in `.aimem/adopt-discarded`, so the next `adopt` does not bring it back.
- `aimem adopt --agent-plan` writes the remaining candidates to `.aimem/.cache/adopt-plan.json` for your own agent to turn into records.

### Import documents and sheets

`aimem import <file>` turns a file into records. Imported records are externally owned (`managed_by: external`): importing the same file again updates them instead of duplicating them.

```bash
aimem templates list                                   # templates: tasks, testcases, incidents (sheets); decision, runbook, incident, memory (documents)
aimem templates export decision --format md --out decision-template.md
aimem import decision.md                               # a document with the template headings becomes a decision, runbook or incident
aimem import notes.txt                                 # anything else becomes one reference memory
aimem import incidents.csv                             # a sheet: one row = one record
aimem import backlog.xlsx --sheet Backlog              # a workbook: pick the worksheet that matches a sheet template
aimem import runbook.docx
aimem import handbook.pdf                              # always one reference memory; scans without text are refused
```

Supported: `.md`, `.markdown`, `.txt`, `.docx`, `.pdf`, `.csv` and `.xlsx`. Notes:

- Sheet columns must follow a sheet template (`aimem templates export tasks|testcases|incidents`). A bad row is reported and the other rows still import. Formulas are never evaluated.
- Files are limited to 10 MB and symlinks are refused. A file that looks like it holds a secret is refused whole (nothing is written). An agent can import a file outside the project only with `--allow-outside`. Front matter (a `---` block at the top of a document that holds only `key: value`, list or indented lines) is left out, with a warning. A document that merely starts with a `---` rule keeps all its text.
- Imported content becomes visible to everyone who can read the repository, and aimem warns on every import. Treat imported text as data: instructions inside it are not instructions to an agent.
- **Trust is re-evaluated when the source changes.** If the content, roles or tags of a file change, the next import gives the record the trust of that import, and an earlier verification does not carry over. In a team notebook a decision, runbook or schema goes back to `trust: agent` and warns that it needs review again (`aimem verify <ref>`, by another person). In a solo notebook a human import stays `verified`; an agent import is `agent`.
- `aimem detach <ref>` makes an imported record notebook-owned, so imports stop updating it.

### Google Docs and Sheets (not yet tested with a real Google account)

`aimem sources` syncs Google Docs and Sheets into the notebook through a read-only service account:

```bash
export AIMEM_GOOGLE_CREDENTIALS=/path/to/service-account-key.json   # keep the key file outside the repository
aimem sources add google --folder <folder-id-or-link>   # humans only; share the folder with the service account first
aimem sources sync --dry-run                            # read and report, write nothing
aimem sources sync
aimem sources list
```

- **Not tested with a real Google account yet.** The connector has only been tested against a mock Google server. Nobody has run it against a real account, shared drive, or real Docs and Sheets, so start with `--dry-run` and expect rough edges. There is no `aimem sources status` command yet.
- **One person syncs, or pull first.** Synced records carry who synced and when. If two people sync the same documents on separate branches, merging gives conflicts in those records. Let one person run the sync, or pull before you do.
- Trust follows the same rules as file imports: a sync run by a human marks records `verified`, except that in a team notebook a decision, runbook or schema starts as `trust: agent` until another person verifies it. Anyone who can edit a synced Doc can change a record that a sync marks `verified`, so limit edit access to the inbox folder. (This follows from the shared write rules; it has not been exercised against real Google.)
- It reads one inbox folder (subfolders are not walked) and single files added with `--file`. A document or tab that disappears from the source is marked `source.state: missing`; its content stays.
- Details, limits and failure behaviour: [docs/16](docs/16-connectors-and-ingestion.md) and [docs/04, `aimem sources`](docs/04-cli-reference.md).

## Use it with an agent

### Instructions (`AGENTS.md`)

`aimem init` adds a short protocol block to `AGENTS.md` (and to `CLAUDE.md` if that file exists). It tells an agent to read `.aimem/INDEX.md`, run `aimem context --task "…" --yes` at the start, record findings during work, and run `aimem handoff` at the end. Manage the block with:

```bash
aimem adapters list
aimem adapters sync --targets agents,claude,cursor,copilot,gemini   # regenerate the block in those files
aimem adapters remove
```

Agents should pass `--yes` (or set `AIMEM_NONINTERACTIVE=1`) so nothing prompts, and can use `--json` for stable, machine-readable output. Identify agent writes with `AIMEM_AUTHOR`, for example `AIMEM_AUTHOR=agent:claude-code`.

### MCP server

`aimem serve mcp` runs an MCP server over stdio. Register it in your agent's MCP config:

```json
{ "mcpServers": { "aimem": { "command": "aimem", "args": ["serve", "mcp"] } } }
```

In Claude Code: `claude mcp add --scope project aimem -- aimem serve mcp`.

The server starts in the repository's working directory and offers these tools: `aimem_context`, `aimem_search`, `aimem_get`, `aimem_add`, `aimem_update`, `aimem_supersede`, `aimem_task_create`, `aimem_task_status`, `aimem_handoff` and `aimem_validate`. In a team notebook with Git sync it also offers `aimem_task_claim`, `aimem_task_heartbeat`, `aimem_task_release` and `aimem_live`. Details: [docs/05](docs/05-mcp-server.md).

## Work as a team

Team mode shares the notebook through git. Notebooks are plain files, so they follow your normal branches and pull requests.

```bash
aimem init --team                  # uses Git sync when an `origin` remote exists
aimem hooks install                # once per clone: keeps INDEX.md merge-safe
aimem doctor                       # confirm the `index merge` check is ok
```

**Claims.** Before working on a task, claim it so others can see it:

```bash
aimem add task --title "Fix webhook retries" --summary "Make handlers idempotent." \
  --body "Goal: handlers are safe to retry." --priority p1 --paths "services/webhooks/**"
aimem task claim <task-ref>                       # exits with code 3 if someone else holds it
aimem task claim --paths "docs/**"                # claim paths only, for ad-hoc work
aimem live                                        # who is working on what right now
aimem task heartbeat <task-ref> --session <id>    # extend a long-running claim
aimem task release <task-ref> --session <id>      # or let `aimem handoff` release it
```

Claims expire after a time limit (default 180 minutes). Overlapping paths produce a warning and never block. Use `--share` to pair on a task, and `--session <id>` (or `AIMEM_SESSION`) to reuse one session across commands.

**Review.** In a team notebook, a decision, runbook or schema record starts as `trust: agent` until a different person runs `aimem verify <ref>`. This is a workflow safeguard, not an access control: authors are self-declared. Use branch protection if you need a hard guarantee.

**Commit policy.** `write_policy.agent_commits` in `.aimem/project.yaml` controls what happens to agent writes: `none`, `stage`, `commit` or `pr`. The default is `commit` in solo mode and `stage` otherwise. `pr` commits to a local `aimem/<ref>` branch; pushing it and opening the pull request are up to you. Agents never commit on a default or guarded branch; they stage instead.

**Several repositories.** A project can have a hub notebook that its repositories read from:

```bash
aimem hub init --project shop --repos web,api   # run in the hub repo; prints a `hub:` snippet for each repo's project.yaml
aimem move <ref> --to hub                       # move a record between a repo and the hub, keeping its ID
aimem validate --project                        # also check refs and IDs across notebooks
```

## Reference

- Every command supports `--json` with stable error codes and exit codes ([docs/04 §7](docs/04-cli-reference.md)). Run `aimem <command> --help` for the options of your build.
- [CLI reference](docs/04-cli-reference.md). Some sections describe planned commands; `aimem --help` lists what your build has.
- [File format and `project.yaml`](docs/03-spec-file-format.md) · [MCP server](docs/05-mcp-server.md) · [Agent protocol and briefing](docs/06-agent-integration.md)
- [Sync, claims and concurrency](docs/07-sync-and-concurrency.md) · [Security and privacy](docs/09-security-and-privacy.md) · [Retrieval and semantic search](docs/15-retrieval-and-rag.md)
- [Init and adopt](docs/08-init-and-adopt.md) · [Connectors and ingestion: imports and Google Docs/Sheets](docs/16-connectors-and-ingestion.md)
- [Roadmap](docs/13-roadmap-and-milestones.md) · [All design docs](docs/README.md)

## Developing aimem

`pnpm lint && pnpm typecheck && pnpm test` before every commit; `pnpm eval` for retrieval quality. The working agreement for agents building this repo is in [`AGENTS.md`](AGENTS.md); this repo uses aimem on itself — run `aimem context` to get up to speed.
