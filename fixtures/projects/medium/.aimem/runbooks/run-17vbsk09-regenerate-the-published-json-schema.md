---
aimem: 1
id: run-17vbsk09
type: runbook
title: Regenerate the published JSON Schema
summary: Rebuild the schema package to refresh dist/record.schema.json and project.schema.json.
status: active
trust: verified
roles: [dev]
author: human:akbar
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
verified: 2026-10-11
owner: akbar
---

## When to use
After any change to the Zod schemas.

## Steps
1. pnpm --filter @aimem/schema build
2. Review the snapshot diff
3. Update the snapshot deliberately

## Rollback
Revert the schema change.

## Verify
Snapshot test passes; dist files exist.
