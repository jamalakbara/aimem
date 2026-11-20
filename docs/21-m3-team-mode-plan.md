# 21 — M3 Team Mode Plan

Slices 3.1 through 3.4 were approved. Later slices are proposals.

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

## 3.2 — Acquire an exclusive Git task claim

The acceptance criteria are 12 §4 scenarios 1 and 3. Two clones racing for one task must produce one winner and one `CLAIM_CONFLICT`. A concurrent update to a different task must survive the retry.

### CLI and claim identity

- Add `aimem task claim <ref> [--author <who>] [--session <id>] [--paths <globs>] [--note <text>] [--ttl <minutes>m]` for online Git-backed team notebooks. Use the configured `claims.ttl_minutes` or the existing 180-minute default. Reject invalid TTLs and values that would yield an invalid expiry timestamp.
- Use the existing author resolver for `holder`. Follow OQ-11 by taking the opaque session ID from `--session`, then `AIMEM_SESSION`, then generating a random ID per invocation. Use the same 1–64 character alphabet as `aimem usage record`. Return the chosen ID in the claim and show it in human output so it can be reused.
- Resolve a local task ID or an equivalent project-qualified ref against the local notebook. Use its validated task ID in the filename `claims/<id>.json` and its project-qualified ref in the JSON. Return `USAGE` for invalid syntax or a non-task ref, and `NOT_FOUND` for an unknown or foreign task. Task record contents stay local.
- Bind ownership to both `holder` and `session`. The same pair gets the original claim back on retry, with its timestamps and metadata intact. A different session using the same holder gets `CLAIM_CONFLICT`. Persist `task`, `holder`, `session`, `started`, `heartbeat`, `ttl_minutes`, and any explicit `paths` or `note` using 07 §2.1. Use the injected clock for the initial timestamps. The `on_behalf_of` field is optional and awaits a source for that identity.
- Return `data.claim` in the existing success envelope and use `CLAIM_CONFLICT` (exit 3) with `details.holder` and `details.since` on contention. A missing live branch, corrupt claim, or remote failure uses `SYNC_FAILED` (exit 4). Tell callers with a missing branch how to run the upgrade command. Validate claim input and scan explicit metadata with the existing secret scanner before any remote call. Use `USAGE` for an offline invocation or a notebook without Git claim support.

Existing claims stay in place in this slice. Heartbeat, expiry-driven recovery, release and takeover belong to 3.3. Before 3.3, settle the difference between expired-only takeover in 07 §2.1 and the additional human override in 04 §5. Pairing, path overlap warnings, offline reconciliation and MCP come later.

### Git compare-and-swap

1. Fetch only the live branch into a private, per-invocation ref. Disable updates to `FETCH_HEAD`, ordinary tracking refs and tags. Read the current snapshot by object ID. Verify that any existing task entry is a regular blob with valid claim JSON for this task. Fail closed if the entry is invalid.
2. If the task path is absent, write the claim JSON as a Git blob. Read the live tree into a unique temporary index, add only the validated claim path, and create a commit whose sole parent is the fetched tip. Use the injected Git runner throughout. Extend its options for explicit stdin and per-call environment so the production index stays untouched.
3. Push only the live ref, with a lease bound to the exact fetched tip and tag following disabled. The proposed commit is always a child of the leased tip. The lease also stops a stale writer from recreating a ref removed during an attempt.
4. After a failed push, fetch again and re-evaluate the task. A different owner means conflict. A matching owner means the retry can return the existing claim. If the tip moved and the path is still free, build from that tip and retry, up to three pushes total. If verification is unavailable or publication still fails, return a sanitized `SYNC_FAILED`. Advise callers to reuse their explicit session ID when retrying an uncertain push result.
5. Clean up the private ref and index on normal and error exits. Cleanup failure leaves an isolated temporary artifact and preserves any confirmed claim result.

This proposes an amendment to 07 §2.2. An isolated index and temporary ref provide the existing checkout safety requirement while reusing the repository's Git configuration, relative remotes and object store. An isolated clone or worktree follows the current wording and adds checkout lifecycle and configuration handling. The update will also replace the rebase explanation with fetch-and-reapply semantics and document ownership across CLI invocations in 07 and 14.

### Tests to write first

1. Use two clones of a bare remote and a barrier before the first push. For a single task, verify one success, conflict details for the loser, and one persisted claim. Use the same holder with different sessions to check ownership.
2. Race claims for different tasks from the same tip. Verify a stale attempt retries and the final tree contains both claims. Exercise two concurrent invocations from one checkout and verify staged entries, working files, the current branch and normal tracking refs.
3. Verify identical-session retries return the original claim without moving the live tip. Simulate a push that reached the remote but returned an error, and verify the read-back result. Cover ref deletion, an unreachable remote, a corrupt entry and three rejected pushes.
4. Test flag and environment precedence, generated sessions, local/global ref equivalence, JSON success and conflict shapes, and invalid input. Verify offline and unsupported notebooks, missing tasks and secret findings cause no network calls.

### Expected files

| Area | Files |
|---|---|
| Core | `packages/core/src/claims/acquire.ts` and `packages/core/test/claim-acquire.test.ts` (new), `packages/core/src/git/git.ts`, `packages/core/src/git/live.ts`, `packages/core/src/index.ts` |
| CLI | `packages/cli/src/run.ts`, `packages/cli/src/commands/task.ts` and `packages/cli/test/task-claim.test.ts` (new) |
| Docs | `docs/04-cli-reference.md`, `docs/07-sync-and-concurrency.md`, `docs/14-decisions-and-open-questions.md` |

## 3.3 — Heartbeat, release, expiry and takeover

This slice satisfies 12 §4 scenarios 2 and 4. A claim left by a stopped process becomes visibly expired and can be taken over. The 20-clone × 5-task stress test must finish with one valid claim per task.

### CLI behavior

| Command | Result |
|---|---|
| `aimem task heartbeat <ref>` | Extend an active claim owned by the same author and session. Keep the original start, TTL and metadata. If the local time is equal to or earlier than the stored heartbeat, return the current claim without a push. Missing live entry returns `NOT_FOUND`. |
| `aimem task release <ref>` | Remove the entry owned by the same author and session, including an expired one. Return `data.released: false` for an already absent entry and `true` when the requested deletion is applied or confirmed. |
| `aimem task claim <ref> --steal` | Replace an eligible expired claim with a fresh claim. Require an existing entry. An identical-session retry returns the existing replacement while it is active. |
| `aimem live` | Fetch once and list claims sorted by task ref. Include expired claims and label them “possibly abandoned” in human output. JSON returns `data.claims` with the existing fields plus derived `expired` and `expiresAt`. A successful read with no claims returns an empty list. |

For heartbeat and release, require the existing session ID through `--session` or `AIMEM_SESSION`. Reuse the author resolver and accept local or project-qualified task refs. Look up heartbeat and release in the live tree so a claim can be released even if its durable task record was removed. Ordinary acquisition and takeover still require a local task record.

Heartbeat returns `data.claim`, and takeover preserves the M3.2 claim response. Use `CLAIM_CONFLICT` with the existing holder and since details for ownership conflicts, expired heartbeat, and a takeover before its eligibility window. Ref changes during retries use the same conflict code. Remote errors or malformed live entries use `SYNC_FAILED`. Unsupported or offline invocations fail before network access.

This slice exposes explicit per-task heartbeat and release. Batch heartbeat, automatic context and handoff integration, and release combined with a durable status change need their own plan or contract. Git `live` is a one-shot listing.

### Expiry and takeover policy

- Calculate nominal expiry from the stored heartbeat plus TTL. A claim is visibly expired at that instant, and heartbeat cannot revive it. For Git, use the injected local clock because Git commit timestamps come from clients. Require the five-minute skew allowance in 07 §2.4 to elapse past nominal expiry before takeover.
- Require `--steal` to replace an expired entry, even when the caller was its owner. Ordinary acquire returns a conflict that explains whether the claim is expired. The owner can still release an expired claim during the grace period.
- **Recommend expired-only takeover for all callers.** An active human override would need an authority model and audit contract. The CLI's `human:` author prefix is caller-supplied, and the Git branch authorizes by push access. Resolve the earlier CLI wording in 04 §5 and record the choice in 14.
- Record the previous holder in the takeover commit message on `aimem-live`. Keep the existing claim JSON fields. This history lasts until live-branch compaction.

### Git mutation and retries

Reuse the private ref and temporary index from M3.2. Extend the tree update path to replace or delete one entry, and return the attempted commit ID for read-back. Every mutation creates a child of the fetched tip and pushes with the existing exact-tip lease.

On a rejected or uncertain push, refetch and look for the attempted commit in the new tip's ancestry. If present, return the confirmed result. For release, an absent entry also confirms the requested outcome. Retry an unrelated advance only if the target's most recent path-changing commit is the one originally observed. This protects a later claim even when it reuses a holder, session or identical JSON. A changed target produces a conflict. Honor the three-push limit and preserve the M3.2 behavior on an ordinary acquisition retry.

### Tests to write first

1. Using a fake clock and a real bare remote, check both expiry boundaries, a clock moving backward, expiry without release, and previous-holder evidence in the takeover commit.
2. Check heartbeat and release for correct and incorrect sessions, including the same author with a different session. Verify release after task removal, idempotent repeat release, and preservation of the durable task contents and the user's Git state.
3. Force two takeovers to race and assert exactly one winner. Force a heartbeat or release to race with takeover and verify stale operations preserve the replacement. Exercise unrelated advances, lost responses and release followed by recreation with identical metadata.
4. Check CLI flags, JSON responses, deterministic listing, malformed remote data, and absence of network calls on offline or unsupported invocations.
5. Run 20 real Git clones against one bare remote in five rounds. All 20 sessions contend for the same task in each round, covering five distinct tasks and 100 attempts overall. Require five successes, 95 conflicts, and exactly five parseable claims owned by the returned winners. Keep fast races in normal CI and run the stress test in a dedicated Linux workflow for claim-related PRs, nightly, and on demand.

### Expected files

| Area | Files |
|---|---|
| Core | `packages/core/src/claims/acquire.ts`, new `claims/lifecycle.ts` and shared claim model if needed, `packages/core/src/git/live.ts`, `packages/core/src/index.ts`, lifecycle and stress tests under `packages/core/test/` |
| CLI | `packages/cli/src/run.ts`, `packages/cli/src/commands/task.ts`, `packages/cli/test/task-claim.test.ts` |
| CI and docs | New `.github/workflows/claims-stress.yml`, `docs/04-cli-reference.md`, `docs/07-sync-and-concurrency.md`, `docs/12-testing-strategy.md`, `docs/14-decisions-and-open-questions.md` |

## 3.4 — Path-only and shared claims, overlap warnings and offline reconciliation

Status: approved with the recommended defaults below. 3.4a, 3.4b and 3.4c are implemented. This slice closes 12 §4 scenario 5 and the remaining 07 §2.1 and §2.4 claim rules. Split it into three PRs. Each PR is usable alone and keeps the M3.3 contract for existing exclusive task claims.

| PR | Scope | Acceptance evidence |
|---|---|---|
| 3.4a | Path validation, path-only claims and overlap warnings | Real-remote tests for path-only claim lifecycle and overlap warnings between holders |
| 3.4b | Shared (pairing) claims with `--share` | Two-session join, per-participant heartbeat and release, takeover of a fully expired shared claim |
| 3.4c | `--local` unsynced claims and reconciliation | Scenario 5: unreachable remote, `--local`, recovery, and loss to an earlier live claim |

### Decisions to confirm before coding

1. **Overlap warns and never blocks.** 07 §2.1 says path overlap between different holders produces a warning, because two tasks may touch the same area. The task itself stays exclusive. Recommended: keep the spec. Blocking on overlap would need a spec change in 07 and 04.
2. **Overlap is approximate.** Two globs cannot be compared exactly in general. Compare each glob's static prefix, meaning the segments before the first `*`, `?`, `[` or `{`. Two paths overlap when one prefix equals the other or is a whole-segment ancestor of it. `src/api` overlaps `src/api/routes.ts`; `src/api-v2/routes.ts` does not. False positives are acceptable because the result is only a warning.
3. **Mixed CLI versions.** M3.3 clients read only known claim fields. If an M3.3 client heartbeats a shared claim, it rewrites the file and drops the participants. Recommended: record that team members must upgrade before using `--share`. M3 is unreleased, so no compatibility shim is planned.
4. **Offline claims have no priority.** A `--local` claim never displaces a claim already on `aimem-live`. On reconnection, the CAS decides as for any other claim. Local work is never touched, because claims do not modify the worktree.

### 3.4a — Paths, path-only claims and overlap warnings

**Path validation** (applies to `--paths` on every claim command):

- Normalize to POSIX with `toPosix` and trim each entry.
- Reject empty entries, absolute paths, drive letters, `..` segments, control characters and leading `./`.
- Allow up to 32 entries of up to 256 characters each.
- Invalid input returns `USAGE` before any network call.

**Path-only claims:**

- `aimem task claim --paths "<globs>" [--note <text>]` with no ref creates an ad-hoc claim. It is stored at `claims/<cid>.json`, where `<cid>` is `clm-` plus 8 characters in the existing ID alphabet. The `clm` prefix is added to the live-path grammar only, not to `RECORD_TYPES`.
- The JSON omits `task`, requires `paths`, and adds `id`. Heartbeat, release and `--steal` accept the `clm-` ID in place of a task ref.
- `live` lists path-only claims after task claims, sorted by ID. `live` currently rejects non-task paths, so this widens its validator. One malformed entry is reported as a warning naming its path instead of failing the whole listing. A malformed task-claim entry still fails a claim operation on that task, as before.

**Overlap warnings:**

- On claim and on `--steal`, compare the new paths with every other active claim in the same fetched tip. Ignore claims that are expired or held by the same holder.
- Add one envelope warning per overlapping claim, and add `data.overlaps: [{ ref, holder, paths }]`. The new data field is a deliberate contract addition, documented in 04 §5.
- This needs no extra network call and does not affect the push.

**Follow-up from the #58–#61 review:** when claiming a task whose durable status is `done` or `cancelled`, return a warning, not an error. The status may still be changing on another branch.

### 3.4b — Shared claims

- `aimem task claim <ref> --share` creates a shareable claim. The claim gains `shared: true` and `participants: [{ holder, session, joined, heartbeat }]`. The top-level `holder` and `session` keep naming the first participant for older readers.
- A second session joins with `--share` only if the active claim is shared. An exclusive request against a shared claim, or `--share` against an exclusive claim, returns `CLAIM_CONFLICT`.
- The participant limit is 8.
- **Expiry:** each participant has its own heartbeat. The claim is active while any participant is active. Its nominal expiry is the latest participant heartbeat plus TTL.
- **Heartbeat** updates only the caller's participant entry.
- **Release** removes only the caller. The last release deletes the file.
- **Takeover** with `--steal` is allowed only when every participant has expired and the five-minute allowance has passed. The takeover commit records every previous participant as a separate `Aimem-Previous-Holder` trailer. This fits the existing history rule: evidence lives in `aimem-live` commits until compaction.
- Every edit reuses `mutateClaim`, so the M3.3 path-revision guard protects joins that race with release or takeover.

### 3.4c — `--local` and reconciliation

- Add `--local` to `task claim`. If the online attempt fails with `SYNC_FAILED`, or `--offline` is set, write the intended claim to `.aimem/.cache/claims-pending/<id>.json`. Return success with `data.claim.unsynced: true` and a warning. Without `--local`, behavior is unchanged: `SYNC_FAILED`, exit 4.
- `--local` cannot be combined with `--steal`, because takeover requires a live read.
- **Reconciliation:** the next online claim command, or `live`, first pushes pending claims through the normal acquire path with their stored session.
  - On success, delete the pending file. `started` stays at the local time, and `heartbeat` is set to the sync time.
  - On `CLAIM_CONFLICT`, delete the pending file and warn with the live holder, since time and paths.
  - On `SYNC_FAILED`, keep the pending file.
- If a pending claim's TTL elapsed before sync, drop it with a warning.
- `live` includes pending local claims and marks them `unsynced` in human output and JSON.
- Pending files are in the gitignored cache. They are written atomically and scanned for secrets like any claim metadata.

### Tests to write first

1. **Paths:** a validation table covering absolute paths, `..`, backslashes, empty entries, limits and control characters. Static-prefix overlap as a property test with `fast-check`, including segment-boundary cases.
2. **Path-only claims:** claim, heartbeat, release and `--steal` against a bare remote. `live` ordering, plus one malformed entry that warns instead of failing.
3. **Overlap:** two holders with overlapping and disjoint paths. Same-holder and expired claims produce no warning. Check the JSON `overlaps` shape and the warning text.
4. **Shared claims:** join, reject a mismatched mode, enforce the participant limit, heartbeat and release per participant, last release deletes the file, takeover only after every participant has expired with all previous holders in trailers, and a join racing a release or takeover.
5. **Scenario 5:** point `origin` at an unreachable path. Claim without `--local` returns `SYNC_FAILED`. With `--local`, a pending file is created. Restore the remote and run `live` to sync it. Repeat with another clone claiming first, so the pending claim is dropped with a warning. Also cover a TTL that elapsed while offline and confirm the user's index and worktree are unchanged.
6. **CLI:** flag combinations (`--local` with `--steal`, `--share` with a path-only claim) and JSON contract snapshots updated deliberately.

### Expected files

| Area | Files |
|---|---|
| Core | `packages/core/src/claims/model.ts`, `acquire.ts`, `lifecycle.ts`, new `claims/paths.ts` and `claims/pending.ts`, `packages/core/src/index.ts`, tests under `packages/core/test/` |
| CLI | `packages/cli/src/run.ts`, `packages/cli/src/commands/task.ts`, `packages/cli/test/task-claim.test.ts`, contract snapshots |
| Docs | `docs/03-spec-file-format.md` (claim JSON fields), `docs/04-cli-reference.md` §5, `docs/07-sync-and-concurrency.md` §2.1 and §2.4, `docs/14-decisions-and-open-questions.md` |

After approval, implement 3.4a first on its own branch. Run lint, typecheck and the full suite, require green CI and the claim stress workflow, then continue with 3.4b and 3.4c.
