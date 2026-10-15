---
aimem: 1
id: inc-mqknzdvg
type: incident
title: Draft code landed without tests
summary: About 700 lines of core and schema code existed with no tests and side effects not injected.
status: postmortem_done
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-03T09:00:00Z
updated: 2026-10-03T09:00:00Z
verified: 2026-10-03
links: [hnd-hqq0tyzk, hnd-thmmemvm]
severity: sev3
services: [core]
---

## Impact
Nothing could be trusted; contracts unverified.

## Timeline
- 2026-10-03 written
- 2026-10-11 parked

## Root cause
Code written before the playbook flow existed.

## Fix
Parked in wip/; rebuilt slice by slice tests first.

## Prevention
Plan first, tests first, one slice per PR.
