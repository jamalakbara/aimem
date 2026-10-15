---
aimem: 1
id: hnd-54gctqfc
type: handoff
title: "Handoff 2026-10-13: M2 slice 2.1 `context` v0"
summary: "Done: M2 slice 2.1 `context` v0 · Next: Slice 2.2: eval harness (12 §3) + `medium` eval set (keyword, paraphrase, multilingual, trap cases) using `medium/expected.yaml` groups."
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-10-13T08:03:00Z
updated: 2026-10-13T08:03:00Z
branch: feat/m2-context
---

## Done
- core `context/score.ts` (`scoreCandidates`: filter, query from task + branch words + ref task + path tags, lexical/paths/links/recency/type/role × trust × freshness, pins) and `context/briefing.ts` (`buildBriefing`: warnings, section packing with scaled caps and carry, hard budget guard, md render with safety notice and trust/source labels, heading demotion, explain rows; `estimateTokens` = chars/4). `gitChangedFiles`.
- CLI `context` with all 04 flags; no-arg inference from git changes + branch; `--explain` table; `--format json`; warnings for `--mode hybrid` / `--deep`.
- Tests: scoring components, pins, filters, warnings, determinism, budget property test (150 random budgets/queries), golden briefing `packages/cli/test/__snapshots__/briefing-medium-zod.md`, contract `context.json`. Mutation: loosening caps without the guard is caught.
- Fix during review of the golden output: full bodies now go to top-scoring records, not to pins.
- Docs: 04 context, 06 §2.2a implementation notes, 14 OQ-30. `wip/` deleted (all drafts rebuilt).

## Not done
- Retrieval quality is unmeasured until the eval harness (2.2). Link rescue of hidden records ("unless linked from a selected record") not implemented.

## Next
- Slice 2.2: eval harness (12 §3) + `medium` eval set (keyword, paraphrase, multilingual, trap cases) using `medium/expected.yaml` groups.

## Blocked
- none

## Notes for next agent
- Golden briefing changes whenever scoring or fixture content changes; review the diff, then `vitest -u`.
