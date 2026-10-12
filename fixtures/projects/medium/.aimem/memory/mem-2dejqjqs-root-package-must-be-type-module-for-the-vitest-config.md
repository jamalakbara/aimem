---
aimem: 1
id: mem-2dejqjqs
type: memory
title: Root package must be type module for the Vitest config
summary: "Without type: module in the root package.json, vitest.config.ts is loaded as CommonJS and import.meta errors appear in typecheck."
status: active
trust: agent
roles: [dev]
tags: [tooling, testing]
paths: [package.json, vitest.config.ts]
author: agent:claude-code
created: 2026-10-11T09:00:00Z
updated: 2026-10-11T09:00:00Z
kind: gotcha
---

tsc reported TS1470 for import.meta in vitest.config.ts and Vite warned about ESM syntax in a CommonJS file.

Setting "type": "module" in the root package.json fixed both.
