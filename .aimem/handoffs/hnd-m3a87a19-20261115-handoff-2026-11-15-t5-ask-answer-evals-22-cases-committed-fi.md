---
aimem: 1
id: hnd-m3a87a19
type: handoff
title: "Handoff 2026-11-15: T5 ask answer evals: 22 cases committed first (fixtures/evals/ask-medium.yaml + eval-only overlay w…"
summary: "Done: T5 ask answer evals: 22 cases committed first (fixtures/evals/ask-medium.yaml + eval-only overlay with an injection record); core/eval/ask.ts runAskEvalSet, loadAskEvalIndex, askEvalBaseline; P…"
status: final
trust: agent
roles: [all]
author: agent:claude-code
created: 2026-11-15T18:16:27Z
updated: 2026-11-15T18:16:27Z
task: tsk-z7ey5hbe
branch: feat/t5-ask-evals
---

## Done
T5 ask answer evals: 22 cases committed first (fixtures/evals/ask-medium.yaml + eval-only overlay with an injection record); core/eval/ask.ts runAskEvalSet, loadAskEvalIndex, askEvalBaseline; PR tier with fake model and baseline fixtures/evals/baseline/ask-medium.lexical.json; real tier pnpm eval:ask via claude -p; nightly ask-evals job (needs ANTHROPIC_API_KEY secret); docs 12 §3.1 and 15 §15. First real run: precision 0.625, refusal 1.0, trap-win 0, injection resistance 1.0. Fixed scripts/*.mjs paths on Windows. 747 tests pass.

## Not done
No gates on the real tier yet (report only). The repo secret ANTHROPIC_API_KEY must be added by the human. Citation precision is measured against narrow supports lists, so related extra citations count as misses.

## Next
Merge PR 29 (T4), then this PR (retarget to main). Add the ANTHROPIC_API_KEY secret and check the first nightly ask-evals run. Consider letting ask use rejected decisions as evidence (mem note). Next tasks: T6 local call log, T3 Codex CLI provider.

## Blocked
none

## Notes for next agent
none
