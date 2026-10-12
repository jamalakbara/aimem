---
aimem: 1
id: mem-5e6f7g8h
type: memory
title: Payment provider sends amounts as strings
summary: Webhook payloads carry amounts as decimal strings like "12.50"; parse them, never cast to float.
status: active
trust: verified
roles: [dev]
tags: [payments, webhooks, money]
paths: [src/webhooks/**]
author: human:dana
created: 2026-09-20T11:00:00Z
updated: 2026-09-20T11:00:00Z
verified: 2026-09-20
links: [dec-1a2b3c4d]
kind: gotcha
---

The provider's webhook JSON uses strings for amounts, with two decimals for most currencies and none for zero-decimal ones.

We found this when a `parseFloat` turned "0.29" into 28 minor units. Verify with the sample payloads in `test/webhooks/samples/`.
