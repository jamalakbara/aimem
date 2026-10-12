---
aimem: 1
id: inc-xg53k4e9
type: incident
title: Typecheck broke on an empty package
summary: tsc -b failed because the cli package had a tsconfig but no source files.
status: resolved
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-08T09:00:00Z
updated: 2026-10-08T09:00:00Z
verified: 2026-10-08
links: [hnd-fmafywe5]
severity: sev4
services: [tooling]
started: 2026-10-08T10:00:00Z
resolved_at: 2026-10-11T10:00:00Z
---

## Impact
Local typecheck red; scaffold blocked for a day.

## Timeline
- 2026-10-08 failure seen
- 2026-10-11 packages parked, fixed

## Root cause
Composite project with an empty src.

## Fix
Moved draft packages to wip/ and used a root solution tsconfig.

## Prevention
Only list packages that have sources in tsconfig.json references.
