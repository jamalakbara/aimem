---
aimem: 1
id: dec-75mrvcm4
type: decision
title: Agents never commit; humans commit everything
summary: "First policy: agent writes stay unstaged and a human commits them with their code."
status: superseded
trust: verified
roles: [dev]
tags: [process]
author: human:akbar
created: 2026-05-12T09:00:00Z
updated: 2026-05-12T09:00:00Z
verified: 2026-05-12
superseded_by: dec-k6y6hqdj
---

## Context
Worry about agents polluting history.

## Decision
agent_commits: none in every mode.

## Consequences
Solo users had to commit notebook changes by hand after every session. Replaced.
