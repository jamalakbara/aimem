---
aimem: 1
id: hnd-negqqc1d
type: handoff
title: "Handoff 2026-11-25: M5 slice 5.4 on codex/m5-4-tasks: task board at /p/:project/tasks (a column per status of the schem…"
summary: "Done: M5 slice 5.4 on codex/m5-4-tasks: task board at /p/:project/tasks (a column per status of the schema plus Other status, 10 cards per column, Show all to the list of one status, 25 per page), he…"
status: final
trust: agent
roles: [all]
author: agent:openbot-dito
created: 2026-11-25T13:13:43Z
updated: 2026-11-25T13:13:43Z
branch: codex/m5-4-tasks
---

## Done
M5 slice 5.4 on codex/m5-4-tasks: task board at /p/:project/tasks (a column per status of the schema plus Other status, 10 cards per column, Show all to the list of one status, 25 per page), header links, shared cards/pager/chips in pages/cards.ts used by search with byte-identical output (45 pages compared). Tests first (red: tasks.test.ts did not load), 34 deliberate breakages all caught, 1509 tests pass, lint, typecheck and validate --strict clean. 5,000 notes: board 5.8-26 KB, 53-82 ms over HTTP. Checked in Chromium at 1280/1100/1024/768/390 without script, light and dark.

## Not done
Not merged; Ajaw has not seen the screens; Firefox, Safari, screen readers and axe not tried. 5.5 (decision timeline, handoff feed, browse by type) is next, stacked on this branch.

## Next
Review by someone other than the author (Eko equivalence with list, Opan tests, Ajaw screens). Then 5.5 on top of codex/m5-4-tasks, retargeted to main after 5.4 merges.

## Blocked
none

## Notes for next agent
Board order and the 10-card cap are decisions A/H of docs/24 §5.4. The read-only hash test in viewer.test.ts lists addresses by hand: add each new address there. security scan allows only node:http, node:path, core, schema, markdown-it imports in packages/viewer/src.
