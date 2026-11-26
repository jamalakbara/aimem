---
aimem: 1
id: hnd-31xx22yy
type: handoff
title: "Handoff 2026-11-26: M5 slice 5.7 on codex/m5-7-sources: source labels on cards and record pages, Edit at source (editab…"
summary: "Done: M5 slice 5.7 on codex/m5-7-sources: source labels on cards and record pages, Edit at source (editable systems only, https written as such, no credentials, host shown), import guide at /p/:proje…"
status: final
trust: agent
roles: [all]
author: agent:openbot-dito
created: 2026-11-26T04:42:44Z
updated: 2026-11-26T04:42:44Z
branch: codex/m5-7-sources
---

## Done
M5 slice 5.7 on codex/m5-7-sources: source labels on cards and record pages, Edit at source (editable systems only, https written as such, no credentials, host shown), import guide at /p/:project/import linked from dashboard and Browse. Tests first (source.test.ts did not load), 26 deliberate breakages all caught, 1675 tests pass, lint (one older warning in layout.ts), typecheck and validate --strict clean. Compared with main over HTTP on 5 notebooks: the only differences are the guide link and the source lines. Checked in Chromium at 1280, 390 and 320 px.

## Not done
Not merged. No real Google account; Google URLs were tested in the shape the connector writes. Firefox, Safari, screen readers, axe and a real phone not tried.

## Next
Review by Opan (tests), Ajaw (screens), Virgi (frontend code), Eko (server.ts). Then the owner decides on the merge. 5.8 not started.

## Blocked
none

## Notes for next agent
The import check in viewer.test.ts reads a quoted word import as an import statement, so the guide segment is a template constant (GUIDE_SEGMENT). A fifth header link just fits at 390 px but wraps a label at 320 px.
