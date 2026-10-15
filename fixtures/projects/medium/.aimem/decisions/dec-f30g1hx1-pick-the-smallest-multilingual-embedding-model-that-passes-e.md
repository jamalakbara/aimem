---
aimem: 1
id: dec-f30g1hx1
type: decision
title: Pick the smallest multilingual embedding model that passes evals
summary: The default local model will be the smallest candidate that meets the multilingual eval gate.
status: proposed
trust: verified
roles: [dev]
tags: [embeddings]
author: human:akbar
created: 2026-09-06T09:00:00Z
updated: 2026-09-06T09:00:00Z
verified: 2026-09-06
links: [dec-mtbcq7yr]
---

## Context
Notes are written in English and Indonesian; model size affects install time.

## Decision
Evaluate two or three multilingual candidates in M2 and pin the winner.

## Consequences
Model choice waits for the eval harness.
