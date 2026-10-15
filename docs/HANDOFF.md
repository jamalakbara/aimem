# Handoff log

Append-only session log until M1 ships `aimem handoff` (docs/17 §1 rule 5). Newest first.

## 2026-10-12 — M0 slice 0.2 `@aimem/schema` (branch `feat/m0-schema`, stacked on `feat/m0-scaffold`)

### Done
- Zod 4 schemas: `baseFrontmatterSchema` (status = any string, for V002), `recordSchema` (discriminated union per type with allowed statuses + type fields, for V004), `sourceSchema`, `externalLinkSchema`, `projectSchema` (03 §6 + 15 §11).
- Constants: types/dirs/prefixes/statuses, `DEFAULT_STATUS` (decision = `proposed`), `DEFAULT_PRIORITY`, trust weights, body sections, reserved tags, `ERROR_CODES` (exactly 04 §7; draft's `USAGE` dropped). `INACTIVE_STATUSES` dropped. ID/ref regexes, `isValidId`, `typeFromId`, `parseRef`. `PROJECT_DEFAULTS`.
- JSON Schema export: `exportJsonSchemas()`; `pnpm build` writes `dist/record.schema.json`, `dist/project.schema.json`.
- 77 tests incl. fast-check round-trip (idempotent parse, unknown keys kept, JSON round-trip, ID regex) and JSON Schema snapshot.
- Spec 03: default-status column in §4, `kind` optional, `all` role clarified, V009 vs V002 for summary, "schemas never inject defaults".
- Remote `origin` = github.com/jamalakbara/aimem (not pushed yet).

### Not done
- `newId`/`slugify` (moved to 1.1, core, with injected random). Cross-field rule `managed_by: external ⇒ source` is not in the exported JSON Schema (Zod refine).

### Next
- Slice 0.3 fixtures `tiny`, `medium`, `messy`.

### Blocked
- none

### Notes for next agent
- `aimem` field accepts any positive int so the validator can emit V016; `summary` has no length cap in the schema (V009 warns).
- Incident `started`/`resolved_at` typed as plain strings (03 gives no format).

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
