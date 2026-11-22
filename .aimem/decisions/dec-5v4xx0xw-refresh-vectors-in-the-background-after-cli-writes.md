---
aimem: 1
id: dec-5v4xx0xw
type: decision
title: Refresh vectors in the background after CLI writes
summary: CLI writes spawn a detached low-priority aimem index --embeddings --background instead of loading the model in-process; T1 now meets < 1 s.
status: proposed
trust: agent
roles: [all]
tags: [t1, embeddings, performance]
paths: [packages/cli/src/commands/embedder.ts, packages/cli/src/commands/maintain.ts]
author: agent:openbot-backend
created: 2026-11-21T15:51:47Z
updated: 2026-11-21T15:51:47Z
links: [mem-ggbjf03n]
---

## Context
T1 targets < 1 s per CLI write with embeddings on. Loading the local MiniLM model costs about 1.9 s per CLI process (mem-ggbjf03n), so in-write refresh measured p50 2.7 s.

## Decision
When a write would have to load the model, the CLI returns after the write and starts `aimem index --embeddings --background` detached at lower priority. It never downloads, uses a lock plus a pending marker so only one refresh runs per notebook, and rechecks the marker after releasing the lock. `AIMEM_EMBED_SYNC=1` restores the in-write refresh; injected or in-memory embedders (MCP, tests) stay synchronous.

## Consequences
Measured on 4 vCPU (2026-11-21): CLI write p50 590 ms / p95 701 ms; coverage returns to 100% within seconds. MCP writes p50 416 ms after a one-time 2.9 s load. For a few seconds after a write, semantic coverage is below 100% (doctor shows it).

## Alternatives
A resident daemon (more moving parts and state), lazy refresh on the next read (moves the cost into context at session start), smaller models (failed T7 retrieval targets).
