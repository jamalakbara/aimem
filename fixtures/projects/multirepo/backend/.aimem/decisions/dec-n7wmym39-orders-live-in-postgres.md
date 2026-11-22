---
aimem: 1
id: dec-n7wmym39
type: decision
title: Orders live in Postgres
summary: The backend stores orders in Postgres, not in the document store.
status: proposed
trust: verified
roles: [all]
tags: [orders]
repo: backend
author: human:dana
created: 2026-11-21T00:55:04Z
updated: 2026-11-21T00:55:04Z
verified: 2026-11-21
---

## Context
Orders need transactions.

## Decision
Postgres.

## Consequences
Migrations required.

## Alternatives
Document store.
