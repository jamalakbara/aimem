---
aimem: 1
id: dec-ghsxv3vg
type: decision
title: Use isomorphic-git for repository operations
summary: A pure-JS git library was evaluated and rejected because of gaps in credentials, hooks and worktrees.
status: rejected
trust: verified
roles: [dev]
tags: [git]
author: human:akbar
created: 2026-06-01T09:00:00Z
updated: 2026-06-01T09:00:00Z
verified: 2026-06-01
---

## Context
A library would avoid spawning processes and simplify tests.

## Decision
Rejected after checking feature gaps.

## Consequences
Tests use real temporary repos instead of mocks.
