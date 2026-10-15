---
aimem: 1
id: inc-kxhfs6xz
type: incident
title: Lockfile drift after pnpm 12 upgrade
summary: Corepack fetched pnpm 12 and the lockfile changed format on install.
status: mitigated
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
severity: sev4
services: [ci]
---

## Impact
Noisy diff; CI could reject a stale lockfile.

## Timeline
- 2026-10-11 seen on first install with corepack

## Root cause
packageManager pins pnpm 12 while an older lockfile existed.

## Fix
Regenerated and committed the lockfile.

## Prevention
CI uses --frozen-lockfile.
