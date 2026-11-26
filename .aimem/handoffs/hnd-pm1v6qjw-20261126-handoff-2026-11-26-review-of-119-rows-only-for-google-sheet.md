---
aimem: 1
id: hnd-pm1v6qjw
type: handoff
title: "Handoff 2026-11-26: Review of #119: rows only for google-sheet and upload; Edit at source refuses spaces, control chara…"
summary: "Done: Review of #119: rows only for google-sheet and upload; Edit at source refuses spaces, control characters, back slashes, an empty host and @ in the host part; the import scan in viewer.test.ts s…"
status: final
trust: agent
roles: [all]
author: agent:openbot-dito
created: 2026-11-26T05:31:35Z
updated: 2026-11-26T05:31:35Z
branch: codex/m5-7-sources
---

## Done
Review of #119: rows only for google-sheet and upload; Edit at source refuses spaces, control characters, back slashes, an empty host and @ in the host part; the import scan in viewer.test.ts sees all quotes that the language allows and refuses a hidden import(), with its own tests; the guide test also keeps the 'A person does this' sentence. 1710 tests pass, typecheck and validate --strict clean, one older lint warning. 35 of 36 breakages caught; the survivor is the second credential check, which the written-form rule already covers. Same bytes as main except the guide link and source lines.

## Not done
Not merged. Optional UX notes (aria-describedby, one guide sentence) and URL or row key length limits not done.

## Next
Eko, Ajaw and Opan check the new head again; then Virgi reviews the frontend code and the owner decides on the merge.

## Blocked
none

## Notes for next agent
After from, the scan does not look for back ticks: a static from cannot use them, and a comment in markdown.ts would match.
