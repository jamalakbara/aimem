---
aimem: 1
id: dec-k6y6hqdj
type: decision
title: Agents commit notebook changes directly
summary: "Second policy: agents commit their own record changes immediately in every mode."
status: superseded
trust: verified
roles: [dev]
tags: [process]
author: human:akbar
created: 2026-06-20T09:00:00Z
updated: 2026-06-20T09:00:00Z
verified: 2026-06-20
supersedes: dec-75mrvcm4
superseded_by: dec-ek66gxgx
---

## Context
The no-commit policy left solo users with piles of unstaged records.

## Decision
agent_commits: commit everywhere.

## Consequences
In team repos this mixed agent commits into reviewed feature branches. Replaced.
