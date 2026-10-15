# aimem

A shared, versioned project notebook for humans and AI agents: decisions, gotchas, tasks and session handoffs live as small markdown records in `.aimem/`, committed with your code. Agents start every session with a short, relevant briefing and end it with a handoff, so the next session — human or agent, any tool — doesn't start blind.

> Status: pre-release (v0.1, M0–M2). Not on npm yet; install from source. Design docs: [`docs/`](docs/README.md).

## Install from source

```bash
git clone https://github.com/jamalakbara/aimem.git && cd aimem
pnpm install && pnpm build
cd packages/cli && npm link        # puts `aimem` on your PATH (undo: npm unlink -g aimem)
```

Requires Node ≥ 22, pnpm and git.

## Quick start (in your project)

```bash
aimem init                                   # creates .aimem/ and adds the agent protocol to AGENTS.md
aimem remember --title "…" --summary "…" --body "…"   # record a gotcha (also: decide, incident, runbook)
aimem context --task "what you are about to do"      # the briefing an agent reads at session start
aimem handoff --done "…" --not-done "…" --next "…"   # end of session
aimem index --embeddings                     # optional: multilingual semantic search (downloads ~118 MB once)
```

Agents pick up the protocol from `AGENTS.md` (or `CLAUDE.md` via `@AGENTS.md`). For tools that speak MCP, register `aimem serve mcp`, e.g. in Claude Code: `claude mcp add --scope project aimem -- aimem serve mcp`.

Every command supports `--json` with stable error codes (see [docs/04](docs/04-cli-reference.md)). `aimem doctor` shows what is set up and what, if anything, leaves your machine (by default: nothing).

## Developing aimem

`pnpm lint && pnpm typecheck && pnpm test` before every commit; `pnpm eval` for retrieval quality. The working agreement for agents building this repo is in [`AGENTS.md`](AGENTS.md); this repo uses aimem on itself — run `aimem context` to get up to speed.
