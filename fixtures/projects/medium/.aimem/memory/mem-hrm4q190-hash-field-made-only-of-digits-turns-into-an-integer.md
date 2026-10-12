---
aimem: 1
id: mem-hrm4q190
type: memory
title: Hash field made only of digits turns into an integer
summary: An unquoted content_sha consisting solely of digits is read by YAML as a number, so schema validation fails with V002.
status: active
trust: agent
roles: [dev]
tags: [yaml, format]
author: agent:claude-code
created: 2026-10-10T09:00:00Z
updated: 2026-10-10T09:00:00Z
kind: gotcha
---

YAML resolves an all-digit scalar to an integer. A placeholder sha of zeros became the number 0 and failed the string check on source.content_sha.

Quote hashes and ids that could be all digits when writing frontmatter.
