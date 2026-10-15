# Handoff log

Append-only session log until M1 ships `aimem handoff` (docs/17 §1 rule 5). Newest first.

## 2026-10-12 — M0 slice 0.1 monorepo scaffold (branch `feat/m0-scaffold`)

### Done
- `git init`; first commit = docs + AGENTS.md + CLAUDE.md on `main`.
- Scaffold: pnpm workspace, `tsconfig.base.json` + root solution `tsconfig.json`, `tsconfig.test.json` (strict typecheck of tests), Biome (recommended preset), Vitest, `.nvmrc` (24), engines `>=22`.
- `@aimem/schema` reduced to `SPEC_VERSION` + one smoke test; `pnpm lint && pnpm typecheck && pnpm test` green.
- CI: `.github/workflows/ci.yml` — lint, typecheck, test on ubuntu+macos × Node 22/24.
- Pre-existing untested draft (core, cli, full schema) parked in `wip/` (see `wip/README.md`). Deleted ~24 empty `_tmp_*` leftovers from repo root.

### Not done
- GitHub remote, `main` branch protection (human step, docs/17 §2).
- OQ-1 npm name availability check (M0 item).

### Next
- Slice 0.2 `@aimem/schema`: Zod schemas for 4 core types + `project.yaml`, JSON Schema export, fast-check round-trip tests. Start from `wip/schema/index.ts`.

### Blocked
- none

### Notes for next agent
- Draft deviations to fix when un-parking: side effects not injected (Date/env/fs/`execFileSync`), schema lacks `source`/`external`/`hub`/`repos`/`retrieval`/`claims`/`server` types, `DEFAULT_STATUS.decision = "accepted"` and `INACTIVE_STATUSES` are not in spec 03 — decide in 0.2 (propose spec change or drop).
- Biome 2.5 `migrate` rewrote `recommended: true` to `preset: "none"` (disables all rules); fixed to `"recommended"`.
- Root `package.json` is `"type": "module"` so `vitest.config.ts` loads as ESM.
