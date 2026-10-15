---
aimem: 1
id: dec-kfn2y31q
type: decision
title: Web edits become pull requests
summary: Changes made in the web app are proposed as pull requests with correct authorship instead of direct writes.
status: accepted
trust: verified
roles: [pm, qa, dev]
tags: [web]
paths: [packages/web/**]
author: human:akbar
created: 2026-08-08T09:00:00Z
updated: 2026-08-08T09:00:00Z
verified: 2026-08-08
---

## Context
Non-developers need to edit, but the repo stays the source of truth with review.

## Decision
The server opens a PR per edit; merging it updates the notebook.

## Consequences
Edits are not instant; the review queue shows pending ones.
