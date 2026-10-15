---
aimem: 1
id: dec-ek66gxgx
type: decision
title: Agents stage in team mode and commit in solo mode
summary: Default agent_commits is stage for team projects and commit for solo, so humans commit notebook changes with their code in teams.
status: accepted
trust: verified
roles: [dev]
tags: [process]
author: human:akbar
created: 2026-09-18T09:00:00Z
updated: 2026-09-18T09:00:00Z
verified: 2026-09-18
supersedes: dec-k6y6hqdj
---

## Context
Neither extreme fitted both solo and team use.

## Decision
Solo mode implies agent_commits: commit. Team mode defaults to stage. pr remains available.

## Consequences
Policy is mode-dependent logic in core, not a schema default.
