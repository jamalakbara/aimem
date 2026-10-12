---
aimem: 1
id: dec-fe8ev4k4
type: decision
title: Deterministic offline retrieval, no embeddings
summary: Search uses keyword BM25 plus filters only; no embedding model, fully deterministic and offline.
status: superseded
trust: verified
roles: [dev]
tags: [retrieval]
author: human:akbar
created: 2026-05-03T09:00:00Z
updated: 2026-05-03T09:00:00Z
verified: 2026-05-03
superseded_by: dec-mtbcq7yr
---

## Context
Early scope tried to avoid model downloads and non-determinism in briefings.

## Decision
Retrieval is lexical: BM25 over title, summary, tags and body, plus path and link signals. No vectors.

## Consequences
Paraphrased or Indonesian questions miss English records. Replaced by hybrid retrieval.
