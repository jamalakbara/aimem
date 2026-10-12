---
aimem: 1
id: mem-7ktr68qw
type: memory
title: Agen wajib memakai --yes
summary: Agen harus selalu menjalankan perintah aimem dengan --yes atau AIMEM_NONINTERACTIVE=1 supaya tidak menunggu prompt.
status: active
trust: verified
roles: [dev]
tags: [cli, agents]
author: human:akbar
created: 2026-09-27T09:00:00Z
updated: 2026-09-27T09:00:00Z
verified: 2026-09-27
kind: constraint
---

Tanpa flag ini perintah bisa berhenti menunggu input dan sesi agen macet. Perintah add tanpa body di mode non-interaktif keluar dengan kode 2.
