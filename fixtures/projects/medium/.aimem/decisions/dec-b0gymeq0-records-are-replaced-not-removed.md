---
aimem: 1
id: dec-b0gymeq0
type: decision
title: Records are replaced, not removed
summary: Outdated knowledge is retired by writing a successor that points back to it; files are never erased.
status: accepted
trust: verified
roles: [all]
tags: [format]
author: human:akbar
created: 2026-05-08T09:00:00Z
updated: 2026-05-08T09:00:00Z
verified: 2026-05-08
---

## Context
Deleting a wrong decision loses the reasoning that made it look right at the time.

## Decision
A newer record sets supersedes; the old one becomes superseded with superseded_by. Only unverified, unlinked drafts may be discarded.

## Consequences
The notebook grows forever; filters hide superseded records from briefings.
