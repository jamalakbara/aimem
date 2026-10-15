---
aimem: 1
id: hnd-0eayps0q
type: handoff
title: "Handoff 2026-10-13: M1 slice 1.4c git + validate --fix"
summary: "Done: M1 slice 1.4c git + validate --fix · Next: Slice 1.5: `handoff`, `status`, `doctor`, and the scripted M1 e2e (init → add decision → add memory → handoff → validate) running the **built** binary…"
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-13T08:01:00Z
updated: 2026-10-13T08:01:00Z
branch: feat/m1-git
---

## Done
- `core/git` (`execa`): `Git` interface (never throws; 127 when git can't start), `execaGit`, `isGitRepo`, `gitUserName`. Only module that spawns processes.
- `ops/policy.ts`: `effectivePolicy` (solo → commit, else stage), `applyWritePolicy` (agents only; `git add` + `git commit --only -- <files>`; pr → stage + warning; not a repo / no git / hook failure → warning, records kept), `resolveAuthorWithGit` (flag → env → `user.name` slugified).
- `validate/fix.ts` `fixNotebook`: V015 rename (skip if target exists), V007 missing half (+ status superseded where allowed), `updated` < `created`; refreshes INDEX.md.
- CLI: `CliDeps.git`; write commands report `data.git` and git warnings; `supersede --author`; `validate --fix` with `data.fixed/skipped`. Contracts add/update/verify gained `git` (deliberate).
- Tests: real temp git repos isolated via `GIT_CONFIG_GLOBAL=/dev/null` (commit only touched files, staged work untouched, team stage, pr, none/human, first commit, no repo, no git, failing hook, author from git); fix on tiny/messy copies; CLI with a fake git. Real-repo smoke test by hand.
- OQ-4 resolved; 04 §1/§4/validate updated.

## Not done
- `link`, `discard`, `move`, `review`; PR policy; live branch (M3).

## Next
- Slice 1.5: `handoff`, `status`, `doctor`, and the scripted M1 e2e (init → add decision → add memory → handoff → validate) running the **built** binary in a temp git repo.

## Blocked
- none

## Notes for next agent
- Tests that use real git must pass `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` so the developer's config (signing, hooks paths) can't leak in.
- `validate --fix` does not stage/commit its changes (no author involved); the human commits them.
