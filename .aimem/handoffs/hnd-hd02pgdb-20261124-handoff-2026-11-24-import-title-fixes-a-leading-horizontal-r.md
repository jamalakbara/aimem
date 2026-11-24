---
aimem: 1
id: hnd-hd02pgdb
type: handoff
title: "Handoff 2026-11-24: Import title fixes: a leading horizontal rule is skipped when the title comes from the first line;…"
summary: "Done: Import title fixes: a leading horizontal rule is skipped when the title comes from the first line; zero-width space and word joiner removed from titles and summaries (ZWNJ/ZWJ kept); aimem impo…"
status: final
trust: agent
roles: [all]
author: agent:openbot-junior-backend
created: 2026-11-24T03:29:16Z
updated: 2026-11-24T03:29:16Z
branch: fix/import-title-and-help
---

## Done
Import title fixes: a leading horizontal rule is skipped when the title comes from the first line; zero-width space and word joiner removed from titles and summaries (ZWNJ/ZWJ kept); aimem import --help names all formats. Tests first (6 new). Full suite 1233 passed, lint, typecheck, validate --strict clean.

## Not done
Zero-width characters in sheet row titles and Google Doc names are unchanged (only document titles and summaries); sources status still missing.

## Next
Review; decide whether to also clean sheet titles and Google names.

## Blocked
none

## Notes for next agent
none
