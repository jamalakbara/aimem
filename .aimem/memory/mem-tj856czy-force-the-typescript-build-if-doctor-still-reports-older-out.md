---
aimem: 1
id: mem-tj856czy
type: memory
title: Force the TypeScript build if doctor still reports older output
summary: If the mtime-based development-build warning survives pnpm build, run pnpm exec tsc -b --force and check doctor again.
status: active
trust: agent
roles: [all]
tags: [build, doctor, typescript]
paths: [docs/11-tech-stack-and-repo-layout.md]
author: agent:codex
created: 2026-11-18T14:07:43Z
updated: 2026-11-18T14:07:43Z
kind: gotcha
---

Observed during T7 completion: doctor still reported seven newer sources after an incremental build. pnpm exec tsc -b --force re-emitted the outputs and cleared the warning. Doctor compares modification times rather than proving content equivalence; unchanged emitted JS can retain an older timestamp.
