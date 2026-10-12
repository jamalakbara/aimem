---
aimem: 1
id: dec-mtbcq7yr
type: decision
title: Hybrid retrieval with local embeddings in v1
summary: Briefings fuse BM25 with a local multilingual embedding model and fall back to lexical when no model is present.
status: accepted
trust: verified
roles: [dev]
tags: [retrieval, embeddings, pinned]
paths: [packages/core/src/retrieval/**, packages/core/src/embed/**]
author: human:akbar
created: 2026-09-05T09:00:00Z
updated: 2026-09-05T09:00:00Z
verified: 2026-09-05
supersedes: dec-fe8ev4k4
---

## Context
Evaluation sketches showed keyword search failing on paraphrases and on mixed English/Indonesian notes.

## Decision
Ship hybrid retrieval in M2: chunking, local embeddings, vector cache and weighted fusion. Keep a lexical-only path that works with the model removed.

## Consequences
Model download becomes part of setup. Any weight or model change must show eval deltas.
