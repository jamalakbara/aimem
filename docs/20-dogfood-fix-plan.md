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

## Implementation evidence (2026-11-18)

| Slice | PR | Validation |
|-------|----|------------|
| Agent commits on main | [#51](https://github.com/jamalakbara/aimem/pull/51) | Real git default/feature/detached/custom-default cases; deliberate staged-result JSON snapshots; 834 tests passed, one skipped. |
| Stale linked build | [#52](https://github.com/jamalakbara/aimem/pull/52) | Injected timestamps/entry path; fresh/stale/missing/installed/unavailable cases; 838 tests passed, one skipped. |
| Long handoffs dominate search | [#53](https://github.com/jamalakbara/aimem/pull/53) | Test-first sanitized queries; cached MiniLM notebook/medium and real Sonnet answer reports; 846 tests passed, one skipped. |

Each slice passed lint, typecheck and strict notebook validation locally. Search's
0.5 prior exempts explicit history terms; default context eval is unchanged, and
answer support recall is unchanged despite ten deliberate candidate-selection
baseline changes. See docs/12 §3.3 and docs/15 §7 for metrics and limitations.
All three slices merged on 2026-11-18 after all six OS/Node checks passed.
[CI repair #54](https://github.com/jamalakbara/aimem/pull/54) uses supported Intel
macOS runners after Arm runner-acquisition failures, and tests both optional
inference-runtime failure states (docs/12). The final suite passes 848 tests,
with one skipped. The task audit records 11 done and T7 open: its +0.15 default
paraphrase target remains unmet (+0.0909).
