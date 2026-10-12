---
aimem: 1
id: inc-242wrkm4
type: incident
title: Lint silently disabled
summary: After biome migrate, lint passed on everything because the preset was none.
status: resolved
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-12T00:00:00Z
updated: 2026-10-12T00:00:00Z
verified: 2026-10-12
links: [mem-rj2t0xj9]
severity: sev3
services: [ci]
---

## Impact
Any lint problem would have reached main unnoticed.

## Timeline
- 2026-10-12 noticed in migrate output, fixed same session

## Root cause
Migration mapped recommended: true to preset: none.

## Fix
Set preset to recommended and probed with an explicit any.

## Prevention
Probe lint after any lint config change.
