---
aimem: 1
id: hnd-64f9qbzz
type: handoff
title: "Handoff 2026-11-22: Fixed the #88 QA findings on codex/m4-2b-adopt-review-fixes: adopt duplicate check is title-only ag…"
summary: "Done: Fixed the #88 QA findings on codex/m4-2b-adopt-review-fixes: adopt duplicate check is title-only against non-adopted records (50 template ADRs -> 40 written + 10 cut, was 1), binary .md skipped…"
status: final
trust: agent
roles: [all]
author: agent:openbot-backend
created: 2026-11-22T16:43:37Z
updated: 2026-11-22T16:43:37Z
branch: codex/m4-2b-adopt-review-fixes
---

## Done
Fixed the #88 QA findings on codex/m4-2b-adopt-review-fixes: adopt duplicate check is title-only against non-adopted records (50 template ADRs -> 40 written + 10 cut, was 1), binary .md skipped, heading-less ADRs keep their text as Context. Verified cap 40 and write_policy pr (one aimem/* branch, one commit) with real git.

## Not done
Manifest/migrations/CI extractors; 4.3, 4.4, 4.5.

## Next
QA reviews this PR; then 4.5 aimem review/discard.

## Blocked
none

## Notes for next agent
none
