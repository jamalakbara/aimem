---
aimem: 1
id: tsk-6khpns62
type: task
title: "T6: Local call log for LLM and embedding calls"
summary: Trace each LLM and embedding call without storing record text by default.
status: done
trust: agent
roles: [all]
paths: [packages/core/src/, packages/cli/src/commands/embedder.ts]
author: agent:claude-code
created: 2026-11-15T17:27:22Z
updated: 2026-11-17T18:17:15Z
priority: p2
---

## Goal
Make generation and embedding calls debuggable and budgetable without storing record content.

## Acceptance criteria
- [x] JSON-lines log includes time, provider/model, latency, token counts when returned and ref count
- [x] No prompts, record content, answers or credentials in the log
- [x] Doctor reports log location and metadata-only contents
- [x] T2 provider integration and embedding call instrumentation complete

## Notes
Implemented and merged in PRs #32/#33. Fixed gitignored .aimem/.cache/calls.jsonl, injected append writer, CLI/MCP LLM and embedding instrumentation, doctor status. Diagnostics failures do not change provider outcomes. Core and CLI tests cover success/failure metadata, privacy and storage errors. T8 later extends the existing kind set with rerank.local; T9 usage capture is a separate explicit log.
