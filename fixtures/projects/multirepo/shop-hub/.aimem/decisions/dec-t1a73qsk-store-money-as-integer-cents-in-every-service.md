---
aimem: 1
id: dec-t1a73qsk
type: decision
title: Store money as integer cents in every service
summary: All services exchange amounts as integer cents with an ISO currency code.
status: proposed
trust: verified
roles: [all]
tags: [money]
author: human:dana
created: 2026-11-21T00:55:01Z
updated: 2026-11-21T00:55:01Z
verified: 2026-11-21
---

## Context
Services disagreed on rounding.

## Decision
Use integer cents plus a currency code across services.

## Consequences
Every API field for money is an integer.

## Alternatives
Decimal strings: harder to validate.
