---
aimem: 1
id: dec-nppkpt6e
type: decision
title: Anggaran token dihitung dengan chars/4
summary: Ukuran briefing diperkirakan dengan jumlah karakter dibagi empat, dengan override per model.
status: accepted
trust: verified
roles: [dev]
tags: [briefing]
paths: [packages/core/src/context/**]
author: human:akbar
created: 2026-06-25T09:00:00Z
updated: 2026-06-25T09:00:00Z
verified: 2026-06-25
---

## Context
Tokenizer yang tepat berbeda untuk tiap model dan menambah dependensi berat.

## Decision
Gunakan heuristik chars/4 untuk semua anggaran; tokenizer opsional bisa dipasang nanti.

## Consequences
Estimasi bisa meleset sekitar 10–20%, jadi batas per bagian diberi ruang.
