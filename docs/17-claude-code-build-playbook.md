# 17 — Build Playbook for Claude Code

How to have Claude Code (or any coding agent) build aimem from these docs, one reviewable step at a time. Written for the human who supervises; the agent reads `AGENTS.md` and the prompts below.

## 1. The flow

```
 you pick the milestone ─► agent plans (no code) ─► you approve plan
        ▲                                                  │
        │                                                  ▼
 you merge / reject ◄─ agent opens PR ◄─ agent builds slice by slice
        │                (tests + docs + handoff)          (red → green → refactor)
        └─► next slice
```

Rules of the flow:
1. **One milestone at a time** (13), in order. One PR per *slice* (§4), never per milestone.
2. **Plan first, then code.** Every slice starts in plan mode: the agent restates acceptance criteria, lists files, tests and risks. You approve before code is written.
3. **Spec is the contract (03).** If the agent needs a field that is not in the spec, it proposes a doc change in the same PR, not a silent invention.
4. **Tests define done.** A slice is done when its acceptance tests pass in CI, not when the code "looks right".
5. **Every session ends with a handoff.** Since slice 2.7 the agent uses aimem on itself (`aimem handoff`); `docs/HANDOFF.md` only points there (its earlier entries were migrated into `.aimem/handoffs/`).

## 2. One-time setup (you, ~30 min)

| Step | Detail |
|---|---|
| Git repo | `git init`, push to GitHub (private). Protect `main`: PR required, CI required. |
| Commit docs | Commit `docs/` and `AGENTS.md` as the first commit. |
| `CLAUDE.md` | Create a one-line file: `@AGENTS.md` (Claude Code imports it, so there is one source of truth). |
| Tooling | Node LTS, pnpm, git ≥ 2.30. Embedding model download happens at M2, not before. |
| Permissions | Allow the agent: `pnpm`, `git` (no force-push), `node`, test runners. Deny: deploys, publishing to npm, editing CI secrets. |
| Branch rule | Agent works on `feat/<milestone>-<slice>`; never commits to `main`. |

## 3. Reusable prompts

Replace `<…>`. Paste into Claude Code.

**Start a slice (plan only)**
```
Read AGENTS.md, docs/README.md, docs/03-spec-file-format.md and docs/13-roadmap-and-milestones.md.
We are on <milestone>, slice "<slice name>" (see docs/17 §4).
Do NOT write code yet. Produce a plan: acceptance criteria (quoted from the docs),
files to create/change, tests to write first, open questions (check docs/14 for defaults),
and anything in the spec that looks wrong or missing. Wait for my approval.
```

**Build the slice**
```
Plan approved. Implement it test-first on branch feat/<milestone>-<slice>.
Keep to docs/11 (TypeScript strict, package dependency rules, injected side effects).
When done: run lint, typecheck and all tests; update any docs you contradicted;
write a short PR description (what, why, how tested, spec changes); stop and report.
```

**Review (fresh session, so the reviewer didn't write the code)**
```
Review branch feat/<milestone>-<slice> against docs/03, the slice's acceptance criteria
and docs/09 (security). Look for: invented fields, missing tests, untested error codes,
non-atomic writes, secrets in fixtures, breaking --json/exit-code contracts.
List findings by severity. Do not fix anything.
```

**Close the milestone**
```
Check every acceptance criterion of <milestone> in docs/13 and report pass/fail with evidence
(command output or test name). List what is deferred and add it to docs/14 as open questions.
```

**Resume after a break**
```
Read AGENTS.md. Then read the latest handoff (docs/HANDOFF.md, or `aimem context` once M1 exists)
and tell me where we are, what is next, and what is blocked. Do not start work.
```

## 4. Slices (suggested order)

Each slice is small enough to review in under an hour.

| Milestone | Slice | Proves |
|---|---|---|
| **M0** | 0.1 Monorepo scaffold: pnpm workspaces, tsconfig, Biome, Vitest, CI skeleton | `pnpm test` runs green on an empty package |
| | 0.2 `@aimem/schema`: Zod schemas for 4 core types + `project.yaml`, JSON Schema export | round-trip property tests |
| | 0.3 Fixtures `tiny`, `medium`, `messy` | fixtures validate / fail as designed |
| **M1** | 1.1 Records I/O: parse/serialize, atomic write, unknown keys preserved, ID + slug | I/O tests, no data loss |
| | 1.2 Validator V001–V018 + secret scanner | one test per code |
| | 1.3 Index + `INDEX.md` render + BM25 search | deterministic output |
| | 1.4 CLI: `init --solo`, `add`, `show`, `list`, `update`, `supersede`, `verify` | `--json` contracts, exit codes |
| | 1.5 `handoff`, `status`, `doctor`, scripted e2e | the M1 acceptance e2e |
| **M2** | 2.1 `context` v0 (filter + BM25 + paths + packing + `--explain`) | budget compliance 100% |
| | 2.2 Eval harness (12 §3) + `medium` eval set | recall@10 measured |
| | 2.3 Chunking + embeddings behind an interface, lexical fallback, vector cache | works with model removed |
| | 2.4 Fusion, link expansion, paraphrase + multilingual evals, pick default model (OQ-16) | hybrid beats lexical |
| | 2.5 Adapters (`AGENTS.md`, `CLAUDE.md`, Cursor, Copilot, Gemini) with managed block | idempotent sync, `adapters remove` clean |
| | 2.6 MCP server (stdio), all tools in 05 | contract tests per tool |
| | 2.7 Dogfood: `aimem init` on this repo, migrate `docs/HANDOFF.md` | **gate: one real week of use** |
| **M3 → M7** | Follow 13; split each milestone's deliverables into slices the same way, in a plan-first step | — |

Rule of thumb for slicing: if a plan needs more than ~10 files or two packages, split it.

## 5. Definition of done (every slice)
- [ ] Acceptance criteria from the docs are met, with tests that fail without the change.
- [ ] Lint, typecheck, unit + integration tests green in CI.
- [ ] No contract change (`--json`, error codes, exit codes, file format) without a doc update and a note in the PR.
- [ ] No secrets or personal/company data in code, fixtures or docs.
- [ ] Docs touched are consistent (README index, cross-references, ADR/OQ links).
- [ ] A handoff exists (what was done, what is next, gotchas).

## 6. Guardrails against common agent failure modes

| Failure | Guardrail |
|---|---|
| Invents fields/statuses not in the spec | Rule 3; reviewer prompt checks specifically for it |
| Big-bang PRs | Slices; reject PRs touching > ~10 files without a reason |
| Tests written after, to match the code | Plan names tests first; reviewer checks tests fail without the change |
| Mocks hide real git behaviour | Integration tests use real temporary git repos (12) |
| Scope creep into server/web early | `AGENTS.md`: earliest unfinished milestone only |
| Silent contract change | Contract snapshot tests for `--json` and error codes |
| Context loss between sessions | Handoff at session end; "resume" prompt at start; from M1 onward use aimem itself |
| Optimistic "done" claims | Close-the-milestone prompt demands evidence per criterion |
| Heavy dependency creep | New dependency needs a line in the PR justifying it (see 11) |

## 7. When to involve a human
Stop and ask you when: a spec rule conflicts with an acceptance test; a decision in 14 has no default; a change would break a contract; anything touches credentials, publishing or deploys; the slice grows beyond its plan.

## 8. Using multiple agents (optional)
Parallel sessions are safe only when slices touch different packages (e.g. 2.3 embeddings vs 2.5 adapters). Use separate git worktrees/branches, one slice each, and merge sequentially. Never run two agents on the same package.
