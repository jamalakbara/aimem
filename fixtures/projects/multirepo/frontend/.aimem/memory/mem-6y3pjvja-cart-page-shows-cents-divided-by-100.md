---
aimem: 1
id: mem-6y3pjvja
type: memory
title: Cart page shows cents divided by 100
summary: The cart page formats integer cents from the API; never parse floats.
status: active
trust: verified
roles: [all]
tags: [money]
repo: frontend
paths: [web/cart/**]
author: human:dana
created: 2026-11-21T00:56:04Z
updated: 2026-11-21T00:56:04Z
verified: 2026-11-21
links: [acme-shop:dec-t1a73qsk]
kind: gotcha
---

Format with Intl.NumberFormat after dividing by 100 at the edge only.
