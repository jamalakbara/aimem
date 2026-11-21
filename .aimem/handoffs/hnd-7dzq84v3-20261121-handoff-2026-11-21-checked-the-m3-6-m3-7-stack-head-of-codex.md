---
aimem: 1
id: hnd-7dzq84v3
type: handoff
title: "Handoff 2026-11-21: Checked the M3.6/M3.7 stack (head of codex/m3-7c-dedupe) on a copy of the multirepo fixture: status…"
summary: "Done: Checked the M3.6/M3.7 stack (head of codex/m3-7c-dedupe) on a copy of the multirepo fixture: status sources line, context sources header and missing-source warning, [hub]/[repo:x] labels in con…"
status: final
trust: agent
roles: [all]
author: agent:openbot-frontend
created: 2026-11-21T15:39:34Z
updated: 2026-11-21T15:39:34Z
branch: codex/m3-6-source-display
---

## Done
Checked the M3.6/M3.7 stack (head of codex/m3-7c-dedupe) on a copy of the multirepo fixture: status sources line, context sources header and missing-source warning, [hub]/[repo:x] labels in context, search and show, move to hub and the pointer stub all read well. Fixed two human-output gaps: show printed a hub file path as if local, and list had no way to tell hub or sibling records apart. show now prefixes the notebook (hub: .aimem/...), and list adds a SOURCE column only when other notebooks contribute records. JSON unchanged.

## Not done
No merge: the stack waits for the human's end review.

## Next
Review this PR together with #73-#78, after #78.

## Blocked
none

## Notes for next agent
none
