---
aimem: 1
id: mem-qmrpmxdn
type: memory
title: "Duplicate copy of the webhook note"
summary: The payment provider retries webhooks; the handler must be idempotent.
status: active
trust: verified
roles: [all]
tags: [webhooks]
repo: backend
paths: [services/payments/**]
author: human:dana
created: 2026-11-21T00:56:03Z
updated: 2026-11-21T00:56:03Z
verified: 2026-11-21
links: [acme-shop:dec-t1a73qsk]
kind: gotcha
---

The provider retries on any non-2xx and sometimes on success. Deduplicate by event id.
