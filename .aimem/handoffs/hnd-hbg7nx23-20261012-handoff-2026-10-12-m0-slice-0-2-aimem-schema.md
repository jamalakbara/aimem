---
aimem: 1
id: hnd-hbg7nx23
type: handoff
title: "Handoff 2026-10-12: M0 slice 0.2 `@aimem/schema`"
summary: "Done: M0 slice 0.2 `@aimem/schema` · Next: Slice 0.3 fixtures `tiny`, `medium`, `messy`."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-12T08:02:00Z
updated: 2026-10-12T08:02:00Z
branch: feat/m0-schema
---

## Done
- Zod 4 schemas: `baseFrontmatterSchema` (status = any string, for V002), `recordSchema` (discriminated union per type with allowed statuses + type fields, for V004), `sourceSchema`, `externalLinkSchema`, `projectSchema` (03 §6 + 15 §11).
- Constants: types/dirs/prefixes/statuses, `DEFAULT_STATUS` (decision = `proposed`), `DEFAULT_PRIORITY`, trust weights, body sections, reserved tags, `ERROR_CODES` (exactly 04 §7; draft's `USAGE` dropped). `INACTIVE_STATUSES` dropped. ID/ref regexes, `isValidId`, `typeFromId`, `parseRef`. `PROJECT_DEFAULTS`.
- JSON Schema export: `exportJsonSchemas()`; `pnpm build` writes `dist/record.schema.json`, `dist/project.schema.json`.
- 77 tests incl. fast-check round-trip (idempotent parse, unknown keys kept, JSON round-trip, ID regex) and JSON Schema snapshot.
- Spec 03: default-status column in §4, `kind` optional, `all` role clarified, V009 vs V002 for summary, "schemas never inject defaults".
- Remote `origin` = github.com/jamalakbara/aimem (not pushed yet).

## Not done
- `newId`/`slugify` (moved to 1.1, core, with injected random). Cross-field rule `managed_by: external ⇒ source` is not in the exported JSON Schema (Zod refine).

## Next
- Slice 0.3 fixtures `tiny`, `medium`, `messy`.

## Blocked
- none

## Notes for next agent
- `aimem` field accepts any positive int so the validator can emit V016; `summary` has no length cap in the schema (V009 warns).
- Incident `started`/`resolved_at` typed as plain strings (03 gives no format).
