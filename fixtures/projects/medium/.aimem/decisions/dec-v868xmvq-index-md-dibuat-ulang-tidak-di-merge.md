---
aimem: 1
id: dec-v868xmvq
type: decision
title: INDEX.md dibuat ulang, tidak di-merge
summary: INDEX.md ditandai merge=ours dan selalu dibuat ulang oleh hook atau CI, bukan diedit tangan.
status: accepted
trust: verified
roles: [dev]
tags: [index]
paths: [.aimem/INDEX.md]
author: human:akbar
created: 2026-08-14T09:00:00Z
updated: 2026-08-14T09:00:00Z
verified: 2026-08-14
---

## Context
File indeks yang dihasilkan selalu konflik saat dua cabang menambah record.

## Decision
Tandai .aimem/INDEX.md dengan merge=ours di .gitattributes dan regenerasi setelah merge.

## Consequences
Isi INDEX.md bisa tertinggal sebentar sampai hook atau CI berjalan.
