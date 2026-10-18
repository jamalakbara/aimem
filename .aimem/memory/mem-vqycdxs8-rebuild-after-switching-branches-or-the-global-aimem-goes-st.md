---
aimem: 1
id: mem-vqycdxs8
type: memory
title: Rebuild after switching branches or the global aimem goes stale
summary: The global aimem (npm link) runs packages/cli/dist; after a branch switch or pull, run pnpm build or commands like serve mcp may be missing.
status: active
trust: agent
roles: [dev]
tags: [tooling, mcp]
paths: [packages/cli/**]
author: agent:claude-code
created: 2026-10-18T15:42:37Z
updated: 2026-10-18T15:42:37Z
kind: gotcha
---

`npm link` points `aimem` at `packages/cli/dist/bin.js` in this checkout, so it runs whatever was built last — not what is checked out. On 2026-10-18 the dist was from an older branch, `aimem serve mcp` answered "unknown command 'serve'", and Claude Code showed the MCP server as "Connection closed".

Fix: `pnpm build` after every branch switch or pull. Check: `printf '' | aimem serve mcp; echo $?` prints 0.
