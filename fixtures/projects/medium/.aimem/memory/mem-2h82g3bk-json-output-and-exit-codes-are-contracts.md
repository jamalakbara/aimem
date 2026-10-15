---
aimem: 1
id: mem-2h82g3bk
type: memory
title: "--json output and exit codes are contracts"
summary: Agents parse CLI JSON and exit codes; changing their shape needs a doc update and a contract snapshot change.
status: active
trust: verified
roles: [dev]
tags: [cli, contracts]
paths: [packages/cli/**]
author: human:akbar
created: 2026-09-01T09:00:00Z
updated: 2026-09-01T09:00:00Z
verified: 2026-09-01
kind: constraint
---

The envelope is ok/command/data/warnings or ok:false with error.code. Error codes are the stable list in docs/04 section 7.

Contract snapshot tests must fail on any change.
