import { isAbsolute, join } from "node:path";
import { AimemError } from "../errors.js";
import { type Git, gitUserName, isGitRepo } from "../git/git.js";
import type { Notebook, ResolvedProject } from "../project/load.js";
import { slugify } from "../records/ids.js";
import { resolveAuthor } from "./write.js";

export type CommitPolicy = "none" | "stage" | "commit" | "pr";

/** Record types that need a second person's review in team mode (03 §6 `durable_requires_review`). */
export const DURABLE_TYPES: ReadonlySet<string> = new Set(["decision", "runbook", "schema"]);

/** `durable_requires_review`, defaulting to false in solo mode and true otherwise (03 §6). */
export function requiresReview(
  config: Pick<ResolvedProject, "mode" | "write_policy">,
  type: string,
): boolean {
  return DURABLE_TYPES.has(type) && (config.write_policy?.durable_requires_review ?? config.mode !== "solo");
}

/** `write_policy.agent_commits`, defaulting to commit in solo mode and stage otherwise (03 §6, OQ-4). */
export function effectivePolicy(config: Pick<ResolvedProject, "mode" | "write_policy">): CommitPolicy {
  return config.write_policy?.agent_commits ?? (config.mode === "solo" ? "commit" : "stage");
}

export interface PolicyResult {
  action: "none" | "staged" | "committed" | "branched" | "skipped" | "failed";
  warnings: string[];
}

const firstLine = (s: string) => s.trim().split("\n").find(Boolean) ?? "unknown error";

/** Local metadata only: never fetch just to decide whether an agent may commit. */
async function agentCommitGuard(git: Git, cwd: string): Promise<string | undefined> {
  const current = await git.run(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  const branch = current.stdout.trim();
  if (current.code !== 0 || !branch)
    return "agent changes staged because the current branch could not be identified";
  const staged = () => `agent changes staged on ${branch}; commits require a named feature branch`;
  if (["main", "master", "trunk"].includes(branch)) return staged();
  const remotes = await git.run(["remote"], cwd);
  if (remotes.code !== 0) return "agent changes staged because default-branch metadata could not be read";
  for (const remote of remotes.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const head = await git.run(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], cwd);
    if (head.code === 0 && head.stdout.trim() === `refs/remotes/${remote}/${branch}`) return staged();
  }
  return undefined;
}

/**
 * Stage or commit the files an agent just wrote (04 §4). Only those paths are touched:
 * other staged work is left as it is and never included. Human writes are left to the human.
 */
export async function applyWritePolicy(input: {
  git: Git;
  nb: Notebook;
  author: string;
  files: string[];
  message: string;
  /** Explicit request (e.g. `handoff --commit`): applies to any author. */
  override?: CommitPolicy;
}): Promise<PolicyResult> {
  const { git, nb, author, files, message } = input;
  let policy = input.override ?? effectivePolicy(nb.config);
  if ((!input.override && !author.startsWith("agent:")) || policy === "none" || !files.length)
    return { action: "none", warnings: [] };
  const probe = await git.run(["--version"], nb.root);
  if (probe.code !== 0)
    return {
      action: "skipped",
      warnings: [`git is not available (${firstLine(probe.stderr)}); records written but not staged`],
    };
  if (!(await isGitRepo(git, nb.root)))
    return { action: "skipped", warnings: ["not a git repository; records written but not staged"] };
  const guard =
    policy === "commit" && author.startsWith("agent:") ? await agentCommitGuard(git, nb.root) : undefined;
  if (guard) policy = "stage";
  if (policy === "pr") {
    const branched = await commitToBranch(git, nb.root, files, message, author);
    if (branched.ok) {
      return {
        action: "branched",
        warnings: [
          `Saved to local branch ${branched.branch}. Push it and open a pull request: git push origin ${branched.branch}`,
        ],
      };
    }
    policy = "stage";
    const add = await git.run(["add", "--", ...files], nb.root);
    if (add.code !== 0) return { action: "failed", warnings: [`git add failed: ${firstLine(add.stderr)}`] };
    return { action: "staged", warnings: [`${branched.reason}; changes were staged instead`] };
  }
  const add = await git.run(["add", "--", ...files], nb.root);
  if (add.code !== 0) return { action: "failed", warnings: [`git add failed: ${firstLine(add.stderr)}`] };
  if (policy === "stage") return { action: "staged", warnings: guard ? [guard] : [] };
  const commit = await git.run(
    ["commit", "-q", "-m", message, "-m", `Aimem-Author: ${author}`, "--only", "--", ...files],
    nb.root,
  );
  if (commit.code !== 0)
    return {
      action: "failed",
      warnings: [
        `git commit failed: ${firstLine(commit.stderr || commit.stdout)}; records are written and staged`,
      ],
    };
  return { action: "committed", warnings: [] };
}

/**
 * `agent_commits: pr` (03 §6): commit only `files` on a new branch `aimem/<name>` from HEAD, using a
 * temporary index, so the user's branch, index and working tree are left as they are.
 */
async function commitToBranch(
  git: Git,
  root: string,
  files: string[],
  message: string,
  author: string,
): Promise<{ ok: true; branch: string } | { ok: false; reason: string }> {
  const head = await git.run(["rev-parse", "--verify", "-q", "HEAD^{commit}"], root);
  if (head.code !== 0) return { ok: false, reason: "write_policy pr needs at least one commit" };
  const dir = await git.run(["rev-parse", "--git-dir"], root);
  if (dir.code !== 0) return { ok: false, reason: "write_policy pr could not find the git directory" };
  const gitDir = dir.stdout.trim();
  // One scratch index inside .git, rebuilt from HEAD on every use, so nothing needs cleaning up.
  const index = isAbsolute(gitDir) ? join(gitDir, "aimem-pr.index") : join(root, gitDir, "aimem-pr.index");
  const env = { GIT_INDEX_FILE: index };
  const step = async (args: string[]) => {
    const r = await git.run(args, root, { env });
    if (r.code !== 0) throw new Error(firstLine(r.stderr || r.stdout));
    return r.stdout.trim();
  };
  try {
    await step(["read-tree", "HEAD"]);
    await step(["add", "--", ...files]);
    const tree = await step(["write-tree"]);
    const commit = await step([
      "commit-tree",
      tree,
      "-p",
      "HEAD",
      "-m",
      message,
      "-m",
      `Aimem-Author: ${author}`,
    ]);
    const ref = /\b([a-z]{3}-[0-9a-z]{8})\b/.exec(message)?.[1] ?? commit.slice(0, 8);
    let branch = `aimem/${ref}`;
    for (
      let n = 2;
      (await git.run(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], root)).code === 0;
      n++
    )
      branch = `aimem/${ref}-${n}`;
    await step(["update-ref", `refs/heads/${branch}`, commit, ""]);
    return { ok: true, branch };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // Git's own text ("Author identity unknown") does not say what to do inside aimem.
    if (/author identity unknown|empty ident|unable to auto-detect email/i.test(why))
      return {
        ok: false,
        reason:
          "write_policy pr could not commit because Git has no author identity here (set git config user.name and user.email, then write again)",
      };
    return { ok: false, reason: `write_policy pr failed (${why})` };
  }
}

/** 04 §1: `--author` → `AIMEM_AUTHOR` → git `user.name` as `human:<handle>`. */
export async function resolveAuthorWithGit(input: {
  flag?: string;
  env: Record<string, string | undefined>;
  git: Git;
  cwd: string;
}): Promise<string> {
  if (input.flag || input.env.AIMEM_AUTHOR) return resolveAuthor(input);
  const name = await gitUserName(input.git, input.cwd);
  const handle = name ? slugify(name) : undefined;
  if (!handle || handle === "untitled") {
    throw new AimemError(
      "USAGE",
      "no author: pass --author human:<handle> or agent:<tool>, set AIMEM_AUTHOR, or set git config user.name",
    );
  }
  return `human:${handle}`;
}
