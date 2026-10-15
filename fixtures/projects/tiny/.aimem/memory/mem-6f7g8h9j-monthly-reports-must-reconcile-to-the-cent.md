---
aimem: 1
id: mem-6f7g8h9j
type: memory
title: Monthly reports must reconcile to the cent
summary: Finance rejects any monthly report whose totals differ from bank statements by even one minor unit.
status: active
trust: agent
roles: [analyst, dev]
tags: [reporting, money]
paths: [src/reports/**]
author: agent:claude-code
created: 2026-10-01T09:15:00Z
updated: 2026-10-01T09:15:00Z
kind: constraint
---

Report totals are compared against bank statements exactly; there is no tolerance.

Source: the finance review notes for September. Check by running the reconciliation script against the last closed month.
