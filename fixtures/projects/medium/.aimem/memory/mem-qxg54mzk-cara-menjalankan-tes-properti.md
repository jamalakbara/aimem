---
aimem: 1
id: mem-qxg54mzk
type: memory
title: Cara menjalankan tes properti
summary: Tes properti memakai fast-check di dalam Vitest; jalankan pnpm test dan baca contoh yang diperkecil saat gagal.
status: active
trust: agent
roles: [dev]
tags: [testing]
paths: [packages/schema/test/**]
author: agent:claude-code
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
kind: howto
---

fast-check membuat ratusan frontmatter acak dan memeriksa parse idempoten serta kunci tak dikenal tetap ada. Kalau gagal, fast-check menampilkan contoh terkecil dan seed untuk diulang.
