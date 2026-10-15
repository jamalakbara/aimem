---
aimem: 1
id: hnd-7mdje289
type: handoff
title: "Handoff 2026-10-12: M1 slice 1.4a CLI foundation + read commands"
summary: "Done: M1 slice 1.4a CLI foundation + read commands · Next: Plan slice 1.4b: `add` (dedupe → exit 3, TODO template → exit 2, trust by author), `update` (refusals), `supersede`, `verify` (humans only),…"
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-12T08:08:00Z
updated: 2026-10-12T08:08:00Z
branch: feat/m1-cli-read
---

## Done
- New package `aimem` (`packages/cli`, `commander`): in-process `run(argv, deps)` with injected fs/clock/random/env/cwd/stdout/stderr; `bin.ts` entry. Global flags `--json --yes --dir --quiet --verbose`; 04 §7 envelopes; `EXIT_CODES` per error code.
- Commands: `init` (`--solo/--team/--project/--repo/--roles/--force/--no-intake`; writes project.yaml, type dirs + .gitkeep, .gitignore/.gitattributes lines, INDEX.md; prints the 7 intake questions), `show` (`--raw`, `--links`), `list` (`--status --trust --tag --stale`), `search` (all 04 flags; `--mode hybrid` warns, uses lexical), `validate [--strict]`, `index`.
- `USAGE` error code added (schema + 04 §7, human-approved); 04 §7 exit-code table; validate/init behaviour documented.
- Tests: JSON contract files `packages/cli/test/__snapshots__/contracts/*.json`; exit codes; usage errors; init in temp dirs; read commands on fixtures. Built binary smoke-tested by hand.
- Biome now ignores `__snapshots__` (it was reformatting the JSON contracts).

## Not done
- Writing commands, author resolution, git commit policy, `validate --fix` (slice 1.4b). Interactive intake; adapters (2.5); live branch (M3).
- No automated test of the built `bin.js` yet (the 1.5 e2e will run it).

## Next
- Plan slice 1.4b: `add` (dedupe → exit 3, TODO template → exit 2, trust by author), `update` (refusals), `supersede`, `verify` (humans only), author resolution (flag → AIMEM_AUTHOR → git user.name), `write_policy.agent_commits` via `core/git` (execa), INDEX.md refresh after writes, `validate --fix`.

## Blocked
- none

## Notes for next agent
- Contract JSON changes must be deliberate: update the files with `vitest -u` and say so in the PR.
- Biome reflows long lines; scripted text replacements against formatted files can silently miss. Prefer the Edit tool.
