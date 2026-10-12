---
aimem: 1
id: dec-azbscv8t
type: decision
title: Build the Odoo connector in v1
summary: Tasks from Odoo projects would sync one-way into the notebook as part of the first connector set.
status: superseded
trust: verified
roles: [dev, pm]
tags: [connectors, odoo]
author: human:akbar
created: 2026-07-10T09:00:00Z
updated: 2026-07-10T09:00:00Z
verified: 2026-07-10
superseded_by: dec-bgh1zcas
---

## Context
Some teams track work in Odoo and wanted it visible to agents.

## Decision
Include an Odoo connector with json2 and legacy transports in M4b.

## Consequences
Needs network access to the Odoo host and an agreed field allow-list. Replaced by deferring Odoo.
