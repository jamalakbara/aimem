import { join } from "node:path";
import { AimemError } from "../errors.js";
import type { Fs, Random } from "../ports.js";
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

/** A private Git snapshot and index for one claim operation. */
export async function openLiveBranch(
  cwd: string,
  cache: string,
  { git, fs, random }: { git: Git; fs: Fs; random: Random },
) {
  const origin = await git.run(["remote", "get-url", "--push", "--all", "origin"], cwd);
  const [url, ...otherUrls] = origin.stdout.trim().split(/\r?\n/);
  if (origin.code !== 0 || !url || otherUrls.length) {
    throw new AimemError("SYNC_FAILED", "Git claims require an origin remote with one push URL.");
  }
  const id = Buffer.from(random.bytes(16)).toString("hex");
  const remote = `aimem-live-${id}`;
  const ref = `refs/aimem/live/${id}`;
  const index = join(cache, `claim-index-${id}`);
  const localEnv = { GIT_NO_REPLACE_OBJECTS: "1" };
  const remoteEnv = { ...localEnv, AIMEM_GIT_LIVE_URL: url };
  // A temporary remote without a fetch mapping prevents push from updating origin's tracking refs.
  const remoteConfig = [
    `--config-env=remote.${remote}.url=AIMEM_GIT_LIVE_URL`,
    `--config-env=remote.${remote}.pushurl=AIMEM_GIT_LIVE_URL`,
  ];
  const local = async (args: string[], options?: { input?: string; index?: boolean }) => {
    const result = await git.run(args, cwd, {
      env: options?.index ? { ...localEnv, GIT_INDEX_FILE: index } : localEnv,
      ...(options?.input === undefined ? {} : { input: options.input }),
    });
    if (result.code !== 0)
      throw new AimemError("SYNC_FAILED", "Could not read or prepare the Git live branch.");
    return result.stdout;
  };
  const network = (args: string[]) => git.run([...remoteConfig, ...args], cwd, { env: remoteEnv });
  const usingIndex = (args: string[]) =>
    local(["-c", "core.splitIndex=false", "-c", "core.sparseCheckout=false", ...args], { index: true });

  return {
    async fetch(): Promise<string> {
      const result = await network([
        "fetch",
        "--no-tags",
        "--no-prune",
        "--no-write-fetch-head",
        "--no-auto-gc",
        "--no-recurse-submodules",
        "--refmap=",
        remote,
        `+${LIVE_REF}:${ref}`,
      ]);
      if (result.code !== 0) {
        const lookup = await network(["ls-remote", "--exit-code", "--refs", remote, LIVE_REF]);
        if (lookup.code === 2) {
          throw new AimemError("SYNC_FAILED", "aimem-live is missing. Run aimem init --upgrade --sync git.");
        }
        throw new AimemError(
          "SYNC_FAILED",
          "Could not fetch aimem-live. Check Git access and retry with the same session ID.",
        );
      }
      return local(["rev-parse", "--verify", `${ref}^{commit}`]);
    },
    async readFile(tip: string, path: string): Promise<string | undefined> {
      const entry = await local(["ls-tree", "--full-tree", tip, "--", path]);
      if (!entry) return undefined;
      const oid = /^100(?:644|755) blob ([a-f0-9]+)\t/.exec(entry)?.[1];
      if (!oid) throw new AimemError("SYNC_FAILED", "The live claim entry is not a regular file.");
      return local(["cat-file", "blob", oid]);
    },
    async publish(tip: string, path: string, data: string): Promise<boolean> {
      try {
        await fs.mkdir(cache);
      } catch {
        throw new AimemError("SYNC_FAILED", "Could not prepare the temporary Git claim index.");
      }
      const blob = await local(["hash-object", "-w", "--stdin"], { input: data });
      await usingIndex(["read-tree", tip]);
      await usingIndex(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
      const tree = await usingIndex(["write-tree"]);
      const next = await local(["commit-tree", tree, "-p", tip, "-m", "aimem: claim task"]);
      const push = await network([
        "push",
        "--no-follow-tags",
        "--no-recurse-submodules",
        `--force-with-lease=${LIVE_REF}:${tip}`,
        remote,
        `${next}:${LIVE_REF}`,
      ]);
      return push.code === 0;
    },
    async close(): Promise<void> {
      await Promise.allSettled([git.run(["update-ref", "-d", ref], cwd), fs.unlink(index)]);
    },
  };
}
