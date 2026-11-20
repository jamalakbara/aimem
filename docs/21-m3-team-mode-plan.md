# 21 — M3 Team Mode Plan

Slice 3.1 was approved. Later slices are proposals.

## Slice order

| Slice | Deliverable | Acceptance evidence |
|---|---|---|
| 3.1 | Bootstrap the orphan `aimem-live` branch from CLI setup | Real bare-remote tests for first setup, concurrent setup, retries and offline behavior |
| 3.2 | Acquire an exclusive task claim using Git compare-and-swap | Two clones racing for one task produce one winner. An unrelated push triggers a retry (12 §4 scenarios 1 and 3). |
| 3.3 | Add heartbeat, release, expiry, takeover and `live` | Fake-clock and real-remote tests for expired claims and takeover, followed by the 20-clone × 5-task stress run (scenarios 2 and 4). |
| 3.4 | Add path-only and shared claims, overlap warnings, and offline reconciliation | Remote outage and recovery tests (scenario 5). Specify how pairing and takeover history fit the claim model before coding. |
| 3.5 | Wire live claims into context, status, handoff and MCP | CLI and MCP contract tests cover session ownership, offline mode and release. |
| 3.6 | Resolve global refs across local, hub and sibling notebooks | A repo A briefing includes hub and sibling records and warns about missing sources. |
| 3.7 | Complete team write policies, duplicate checks and generated-index handling | Merge and conflict tests (scenarios 6–7), strict validation recipe, and team policy tests. Split into smaller PRs at planning time. |

## 3.1 — Bootstrap `aimem-live`

07 §2.2 calls for an orphan `aimem-live` branch. 08 §1 creates it during Git-backed setup when a remote exists. Today `init --team` selects `sync: git` and prints a warning about future support.

### Proposed behavior

| Invocation | Result |
|---|---|
| `aimem init --team` with `origin` | Use Git sync and ensure `refs/heads/aimem-live` exists. |
| `aimem init --team` without `origin` | Set `sync: none` and explain how to enable Git sync after configuring `origin`. |
| `aimem init --team --sync git` | Require `origin`. Report setup failures as `SYNC_FAILED` (exit 4). |
| `aimem init --team --sync none` or solo init | Create the local notebook. |
| `aimem init --upgrade --sync git` | Ensure the live branch for an existing team notebook using `none` or `git` sync. Change only the `sync` setting when needed and refresh the generated index if the setting changes. |
| Git-backed setup with `--offline` | Skip remote operations, warn that online setup is pending, and point to `init --upgrade --sync git`. |

The slice supports `--sync none|git` and the Git setup form of `--upgrade`. Invalid flag combinations use the existing `USAGE` error. Keep the normal init JSON fields and error envelope. Document the limited upgrade form and the remaining server and hub options in 04 §2.

### Git behavior

Use the injected Git runner to query the explicit live ref on `origin`. Reuse an existing ref. If it is absent, create a parentless commit with an empty tree using Git plumbing, then push that commit to the single live ref with a normal push and tag following disabled. If the push fails, query the same ref again. A ref created by a concurrent initializer, or a successful push whose response was lost, satisfies setup. Otherwise return a sanitized `SYNC_FAILED` with retry guidance.

Bootstrap uses Git's object database and leaves the caller's branch, index and worktree alone. An alternative is an isolated checkout, which adds temporary-directory and configuration handling for an operation that writes zero tracked files. The separate live checkout in 07 §2.2 remains the design for subsequent claim operations.

Validate local setup inputs before creating the remote branch. For online initialization, verify or create the branch before writing notebook files. If a later local write fails, the next valid setup can reuse the remote ref. Document this ordering and the distinction between a missing live ref and an unreachable `origin` in 07 §2.2 and 08 §1.

### Tests to write first

1. Against a temporary bare remote, assert the initial live commit has no parents and an empty tree. Check the durable branch pointer, staged entries and existing working files.
2. Run setup concurrently from two clones. Both finish successfully and the live ref points to a single root commit. Also use the injected Git runner to force a push rejection followed by remote discovery, so the recovery path is covered regardless of timing. Repeat setup through the upgrade path and verify the ref stays put.
3. Assert that an unreachable remote or rejected push produces `SYNC_FAILED` and exit 4. Exercise successful retry against an already-created ref and check that output omits raw Git errors and remote URLs.
4. Cover absent `origin`, `--offline`, explicit local mode and existing solo init. Assert that offline setup makes zero remote calls and that an online upgrade preserves records and unrelated configuration.
5. Verify the normal init JSON fields, invalid combinations, and the existing `--force` safety behavior.

### Expected files

| Area | Files |
|---|---|
| Core | `packages/core/src/git/live.ts` (new), `packages/core/src/index.ts`, `packages/core/test/git-live.test.ts` (new) |
| CLI | `packages/cli/src/run.ts`, `packages/cli/src/commands/init.ts`, `packages/cli/test/init.test.ts` |
| Docs | `docs/04-cli-reference.md`, `docs/07-sync-and-concurrency.md`, `docs/08-init-and-adopt.md` |

Use OQ-5's default of a separate live branch with direct pushes even on repositories with protected main branches. The proposed `origin` convention follows 07 §2.2. Confirm later slices against OQ-3 (one notebook at the repository root), OQ-7 (aimem-native tasks), and OQ-11 (tool-provided session ID where available). The first claim slice must specify ownership across separate CLI invocations and reconcile 07 §2.1's expired-claim takeover with 04 §5's human override before exposing `--steal`.

After approval, implement on a feature branch, run lint, typecheck and the full test suite, and require green CI before closing the slice.
