---
aimem: 1
id: dec-ndgz6y7a
type: decision
title: Shell out to the git binary
summary: All git work runs the user's own git through execa, so credentials, hooks and config behave as usual.
status: accepted
trust: verified
roles: [dev]
tags: [git]
paths: [packages/core/src/git/**]
author: human:akbar
created: 2026-06-02T09:00:00Z
updated: 2026-06-02T09:00:00Z
verified: 2026-06-02
links: [dec-kqfc1se7, dec-ghsxv3vg]
---

## Context
Reimplementing git misses LFS, worktrees and credential helpers.

## Decision
Only core/git spawns processes; it calls the installed git binary.

## Consequences
git must be installed, which is true for every target user.
