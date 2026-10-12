---
aimem: 1
id: mem-x7h3b3km
type: memory
title: Colon-space inside a plain YAML scalar breaks the whole frontmatter
summary: "A handoff summary like Done: x · Next: y must be quoted, otherwise the YAML fails to parse and the record is V001."
status: active
trust: agent
roles: [dev]
tags: [yaml, format]
paths: [packages/core/src/records/**]
author: agent:claude-code
created: 2026-10-10T09:00:00Z
updated: 2026-10-10T09:00:00Z
kind: gotcha
---

Plain YAML scalars may not contain ": ". Handoff summaries follow the pattern "Done: … · Next: …", so they hit this every time.

Found while authoring the messy fixture: the whole frontmatter failed to parse. The 1.1 serializer must quote such values; the fixture README lists it.
