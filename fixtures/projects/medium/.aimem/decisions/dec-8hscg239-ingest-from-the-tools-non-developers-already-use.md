---
aimem: 1
id: dec-8hscg239
type: decision
title: Ingest from the tools non-developers already use
summary: PMs and analysts keep writing in Google Docs and Sheets; connectors turn them into read-only, externally-owned records.
status: accepted
trust: verified
roles: [pm, analyst, dev]
tags: [connectors]
author: human:akbar
created: 2026-07-02T09:00:00Z
updated: 2026-07-02T09:00:00Z
verified: 2026-07-02
---

## Context
Asking non-developers to write markdown in git will not happen.

## Decision
Upload and Google Drive connectors in v1. Each record has one owner: the notebook or the external source.

## Consequences
Externally-owned records cannot be edited locally (READONLY_EXTERNAL).
