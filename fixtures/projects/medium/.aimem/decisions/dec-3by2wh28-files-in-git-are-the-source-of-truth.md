---
aimem: 1
id: dec-3by2wh28
type: decision
title: Files in git are the source of truth
summary: Knowledge lives as markdown records in .aimem/ inside each repo; any database is a rebuildable index.
status: accepted
trust: verified
roles: [all]
tags: [format, git, pinned]
author: human:akbar
created: 2026-04-12T09:00:00Z
updated: 2026-04-12T09:00:00Z
verified: 2026-04-12
---

## Context
Agents and humans need a shared notebook that survives tool changes, works offline and is reviewable like code.

## Decision
Records are plain markdown with YAML frontmatter, committed to git. The sync server and web app only index them and hold ephemeral live state.

## Consequences
History, review and branching come free from git. Anything the server stores must be reconstructible from the repos.

## Alternatives
Database-first service with export: rejected, it makes the server mandatory and hides history.
