# Remaining dogfood fixes

Status: approved on 2026-11-18. These are separate slices after the T7–T9 work.

| Slice | Acceptance and proposed behavior | Files and tests first |
|-------|----------------------------------|-----------------------|
| Agent commits on main | Agent writes stage on `main`, `master`, `trunk`, detached HEAD, or the current branch identified by an available remote HEAD as that remote's default. Named feature branches retain commit behavior. Agent `handoff --commit` does not bypass this guard; explicit human commits remain supported. No new config keys. | `core/src/ops/policy.ts`, core real-git tests, affected CLI contract tests, docs 03/04. Test main vs feature branches, custom remote default, detached HEAD, unrelated staged files, explicit human/agent overrides and failed branch detection. |
| Stale linked build | Doctor compares source files against corresponding built JS in recognized aimem development checkouts. Published installs skip this check. Missing outputs or newer sources warn and suggest rebuilding; doctor still exits 0. | Optional injected filesystem stat port in core; CLI runtime-entry metadata and doctor helper/check; CLI tests; docs 04/11. Tests use injected timestamps for fresh/stale/missing outputs, normal installed packages, unavailable stat and unchanged default JSON envelopes. |
| Long handoffs dominate search | First reproduce notebook-derived build/test queries with sanitized technical notes. Evaluate a handoff relevance prior after lexical/hybrid fusion, retaining explicit handoff searches and existing status filters. Ship a prior only if the new examples improve and medium keyword/trap gates hold. | `core/src/search/search.ts`, search tests, separate eval cases/results and docs 12/15. Test repeated session text against a direct how-to note; run default context and answer evals and report all deliberate ranking deltas. |

## Boundaries and risks

- No automatic branch creation, hidden commits, remote fetches or GitHub-policy
  API calls during a notebook write. Default-branch detection uses local git
  metadata and common branch names; ambiguous/detached current branches stage.
- Build freshness uses modification times as a development diagnostic, not a
  content-proof or new record field. Stat and entry-path metadata remain injected.
- Search priors may hurt questions seeking session history. Keep explicit
  handoff filters useful and inspect real eval deltas before choosing a weight.
- Preserve all existing uncommitted notebook notes. One slice per PR, tests first,
  documented JSON/exit behavior, lint/typecheck/tests, and a final handoff.
