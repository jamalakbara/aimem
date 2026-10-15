---
aimem: 1
id: hnd-c7zhb1qs
type: handoff
title: "Handoff 2026-10-12: M0 slice 0.3a fixtures `tiny` + `messy`"
summary: "Done: M0 slice 0.3a fixtures `tiny` + `messy` · Next: Plan 0.3b `medium` (~120 records, supersede chains, stale items, some Indonesian content for OQ-15 / 15 evals)."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-12T08:03:00Z
updated: 2026-10-12T08:03:00Z
branch: feat/m0-fixtures
---

## Done
- `fixtures/projects/tiny`: 8 clean records (2 per core type), fictional "acme-ledger" money/ledger story.
- `fixtures/projects/messy`: 23 record files, one problem each, covering every code V001–V018; `expected.yaml` maps file → codes (validator contract for 1.2), clock `2026-10-12T00:00:00Z`.
- `fixtures/README.md`. Test-only loader (`packages/schema/test/fixture-loader.ts`, `yaml` dev dep) + `fixtures.test.ts`: tiny is schema-clean, names/links consistent; messy V001–V005 match manifest exactly; manifest covers all 18 codes.
- `isValidSlug` / `SLUG_RE` in `@aimem/schema` (03 §2: `a-z0-9-`, ≤ 60).
- PRs jamalakbara/aimem#1 (0.1) and #2 (0.2) opened.

## Not done
- `medium` fixture (slice 0.3b).

## Next
- Plan 0.3b `medium` (~120 records, supersede chains, stale items, some Indonesian content for OQ-15 / 15 evals).

## Blocked
- none

## Notes for next agent
- YAML gotchas hit while authoring: `summary: Done: x · Next: y` is invalid plain YAML (V001); an all-digit `content_sha` parses as a number (V002). The 1.1 serializer must quote such scalars.
- `dec-0000001f` expects both V017 and V018 (placeholder sha can't match the body); one-problem-per-file rule bent there on purpose.
- V011 expected on both decisions of the pair.
