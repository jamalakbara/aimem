---
aimem: 1
id: mem-nrdpy59z
type: memory
title: No secrets or personal data in fixtures, docs or records
summary: Fixtures are committed and public to every clone, so they hold only fictional or already-public content.
status: active
trust: verified
roles: [all]
tags: [security, fixtures, pinned]
paths: [fixtures/**]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
kind: constraint
---

Applies to all files under fixtures/ and .aimem/. The only secret-like string allowed is AWS's documented example key in the messy fixture.

Check staged diffs for key patterns before pushing.
