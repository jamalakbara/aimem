---
aimem: 1
id: dec-bgh1zcas
type: decision
title: Defer the Odoo connector
summary: Odoo sync is postponed; the design is kept but nothing in v1 depends on it.
status: accepted
trust: verified
roles: [dev, pm]
tags: [connectors, odoo]
paths: [packages/connectors/**]
author: human:akbar
created: 2026-09-12T09:00:00Z
updated: 2026-09-12T09:00:00Z
verified: 2026-09-12
links: [dec-8hscg239]
supersedes: dec-azbscv8t
---

## Context
Odoo version, edition and network placement are unknown, and client data sensitivity is unresolved.

## Decision
Defer the connector. Keep odoo reserved in source.system. Revisit after the open questions are answered.

## Consequences
M4b ships upload and Google only.
