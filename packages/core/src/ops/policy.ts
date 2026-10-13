import { AimemError } from "../errors.js";
import { type Git, gitUserName, isGitRepo } from "../git/git.js";
import type { Notebook, ResolvedProject } from "../project/load.js";
import { slugify } from "../records/ids.js";
import { resolveAuthor } from "./write.js";

export type CommitPolicy = "none" | "stage" | "commit" | "pr";

/** `write_policy.agent_commits`, defaulting to commit in solo mode and stage otherwise (03 §6, OQ-4). */
export function effectivePolicy(config: Pick<ResolvedProject, "mode" | "write_policy">): CommitPolicy {
  return config.write_policy?.agent_commits ?? (config.mode === "solo" ? "commit" : "stage");
}

export interface PolicyResult {
  action: "none" | "staged" | "committed" | "skipped" | "failed";
  warnings: string[];
}

const firstLine = (s: string) => s.trim().split("\n").find(Boolean) ?? "unknown error";

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
}): Promise<PolicyResult> {
  const { git, nb, author, files, message } = input;
  const policy = effectivePolicy(nb.config);
  if (!author.startsWith("agent:") || policy === "none" || !files.length)
    return { action: "none", warnings: [] };
  const probe = await git.run(["--version"], nb.root);
  if (probe.code !== 0)
    return {
      action: "skipped",
      warnings: [`git is not available (${firstLine(probe.stderr)}); records written but not staged`],
    };
  if (!(await isGitRepo(git, nb.root)))
    return { action: "skipped", warnings: ["not a git repository; records written but not staged"] };
  const add = await git.run(["add", "--", ...files], nb.root);
  if (add.code !== 0) return { action: "failed", warnings: [`git add failed: ${firstLine(add.stderr)}`] };
  if (policy === "stage" || policy === "pr") {
    return {
      action: "staged",
      warnings: policy === "pr" ? ["write_policy pr is not supported yet; changes were staged instead"] : [],
    };
  }
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
