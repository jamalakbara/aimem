import { AimemError } from "../errors.js";
import type { Git } from "./git.js";

const LIVE_REF = "refs/heads/aimem-live";

/** Bootstrap the live branch using only Git objects, without a checkout. */
export async function ensureLiveBranch(git: Git, cwd: string): Promise<void> {
  const lookup = ["ls-remote", "--exit-code", "--refs", "origin", LIVE_REF];
  const remote = await git.run(lookup, cwd);
  if (remote.code === 0) return;
  // ls-remote returns 2 when it reached the remote but found no matching ref.
  if (remote.code !== 2) {
    throw new AimemError("SYNC_FAILED", "Could not check aimem-live on origin. Check access and retry.");
  }

  const tree = await git.run(["mktree"], cwd);
  if (tree.code !== 0) throw new AimemError("SYNC_FAILED", "Could not create the empty aimem-live tree.");

  const commit = await git.run(
    ["commit-tree", tree.stdout.trim(), "-m", "aimem: initialize live branch"],
    cwd,
  );
  if (commit.code !== 0) {
    throw new AimemError(
      "SYNC_FAILED",
      "Could not create the aimem-live commit. Check Git identity and retry.",
    );
  }

  // A parentless commit cannot fast-forward an existing ref. Another initializer may win the race.
  const push = await git.run(
    ["push", "--no-follow-tags", "origin", `${commit.stdout.trim()}:${LIVE_REF}`],
    cwd,
  );
  if (push.code === 0 || (await git.run(lookup, cwd)).code === 0) return;
  throw new AimemError("SYNC_FAILED", "Could not publish aimem-live on origin. Check push access and retry.");
}
