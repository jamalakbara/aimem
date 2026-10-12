---
aimem: 1
id: mem-vsh55v8n
type: memory
title: GitHub push protection may block secret-looking fixtures
summary: Fixture strings that look like real keys can be rejected on push; AWS's documented example key is allow-listed.
status: active
trust: agent
roles: [dev]
tags: [security, fixtures]
author: agent:claude-code
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
kind: gotcha
---

The messy fixture needs one secret for V008. Use AKIA plus the documented EXAMPLE suffix rather than a random-looking key, and grep the diff before pushing.
