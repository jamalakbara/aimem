---
aimem: 1
id: mem-ggbjf03n
type: memory
title: T1 CLI write latency is dominated by per-process model load
summary: With a local MiniLM cache, a CLI record write took p50 2.7 s vs 0.45 s without; model load is about 1.9 s, so warm embedding is roughly 0.3-0.4 s.
status: active
trust: agent
roles: [all]
tags: [t1, embeddings, performance]
author: agent:openbot-backend
created: 2026-11-20T13:05:42Z
updated: 2026-11-20T13:05:42Z
links: [tsk-rmd7kq4t]
kind: fact
---

Measured 2026-11-20 at c37bb27 on a 4-vCPU AMD EPYC 9354P VM, 15 GB RAM, Node 26, local paraphrase-multilingual-minilm.

- 20 successful `remember` writes with an embedding cache (coverage 100%): p50 2732 ms, p95 3974 ms, max 9127 ms.
- Same 20 writes without a cache: p50 446 ms, p95 646 ms.
- `search --mode hybrid` (model load + one query embed): p50 2287 ms; lexical search p50 393 ms.

The docs/15 target "< 1 s per record" is met only when the model is already loaded (MCP server); each CLI write reloads the model. The warm figure is an estimate from median differences, not a direct in-process benchmark. Initial `index --embeddings` on 27 records took 29 s including the one-time ~118 MB download.
