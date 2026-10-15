---
aimem: 1
id: mem-rj2t0xj9
type: memory
title: Formatter config migration switched every lint rule off
summary: "biome migrate rewrote recommended: true to preset: none, which silently disables all lint rules; set it to recommended."
status: active
trust: verified
roles: [dev]
tags: [tooling, lint]
paths: [biome.json]
author: human:akbar
created: 2026-10-12T00:00:00Z
updated: 2026-10-12T00:00:00Z
verified: 2026-10-12
kind: gotcha
---

After upgrading Biome to 2.5, the migrate command changed the linter config to a preset of none. Lint kept passing because nothing was checked.

Verify by adding an explicit any to a source file: lint must warn (noExplicitAny).
