import type { Git } from "../git/git.js";
import { firstSentence } from "./markdown.js";
import type { AdoptCandidate, AdoptSkip } from "./types.js";

/** Runs `gh` in the project root (bin: the GitHub CLI; tests inject a fake). */
export type GhRunner = (
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const NOISE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$|^\.aimem\/|(^|\/)(dist|build|vendor|node_modules)\/|\.min\.(js|css)$|\.snap$/;
const FIX = /^(?:fix|hotfix|bugfix)(?:\([^)]*\))?!?:|^revert\b/i;
const MAX_GOTCHAS = 5;
const MAX_HOTSPOTS = 10;

interface Commit {
  sha: string;
  subject: string;
  files: string[];
}

/** 08 §2.1: git history → "Change hotspots" plus gotchas for paths with repeated fixes or a revert. */
export async function gitCandidates(
  git: Git,
  root: string,
  since: string,
): Promise<{ candidates: AdoptCandidate[]; skip?: AdoptSkip }> {
  const prefix = await git.run(["rev-parse", "--show-prefix"], root);
  if (prefix.code !== 0) return { candidates: [], skip: { evidence: "git", reason: "not a git repository" } };
  if (prefix.stdout.trim())
    return {
      candidates: [],
      skip: {
        evidence: "git",
        reason: "the project is not the root of its git repository (monorepo adoption is deferred)",
      },
    };
  const log = await git.run(
    ["log", `--since=${since}`, "--no-merges", "--name-only", "--format=%x1e%h%x09%s"],
    root,
  );
  if (log.code !== 0)
    return { candidates: [], skip: { evidence: "git", reason: `git log failed: ${log.stderr.trim()}` } };
  const commits: Commit[] = log.stdout
    .split("\x1e")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [head = "", ...files] = block.split("\n");
      const [sha = "", ...rest] = head.split("\t");
      return {
        sha,
        subject: rest.join("\t"),
        files: files.map((f) => f.trim()).filter((f) => f && !NOISE.test(f)),
      };
    });
  const counts = new Map<string, number>();
  const fixes = new Map<string, Commit[]>();
  for (const c of commits)
    for (const f of c.files) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
      if (FIX.test(c.subject)) fixes.set(f, [...(fixes.get(f) ?? []), c]);
    }
  const byCount = <T>(m: Map<string, T[] | number>) =>
    [...m].sort(
      (a, b) =>
        (typeof b[1] === "number" ? b[1] : b[1].length) - (typeof a[1] === "number" ? a[1] : a[1].length) ||
        (a[0] < b[0] ? -1 : 1),
    );
  const candidates: AdoptCandidate[] = [];
  const hot = byCount(counts as Map<string, number>)
    .filter(([, n]) => (n as number) >= 2)
    .slice(0, MAX_HOTSPOTS);
  if (hot.length)
    candidates.push({
      source: "git",
      type: "memory",
      title: "Change hotspots",
      summary: `Most changed files since ${since}: ${hot
        .slice(0, 5)
        .map(([p]) => p)
        .join(", ")}.`.slice(0, 200),
      body: hot.map(([p, n]) => `- \`${p}\`: ${n} commits`).join("\n"),
      kind: "fact",
      tags: ["adopted"],
      evidence: ["git-history:hotspots"],
    });
  const risky = byCount(fixes as Map<string, Commit[]>)
    .filter(([, cs]) => {
      const list = cs as Commit[];
      return list.length >= 2 || list.some((c) => /^revert\b/i.test(c.subject));
    })
    .slice(0, MAX_GOTCHAS);
  for (const [path, cs] of risky) {
    const list = cs as Commit[];
    candidates.push({
      source: "git",
      type: "memory",
      title: `Gotchas in ${path}`.slice(0, 120),
      summary:
        `${list.length} fix or revert commit${list.length === 1 ? "" : "s"} touched ${path}; read them before changing it.`.slice(
          0,
          200,
        ),
      body: [
        "Commits that fixed or reverted changes here (newest first):",
        "",
        ...list.map((c) => `- ${c.sha} ${c.subject}`),
      ].join("\n"),
      kind: "gotcha",
      tags: ["adopted"],
      paths: [path],
      // A stable key per path: new fix commits change the body (reported as "source changed"), not the key.
      evidence: [`git-history:${path}`],
    });
  }
  return { candidates };
}

interface Pr {
  number: number;
  title: string;
  body?: string;
  labels?: { name: string }[];
  url: string;
}

const DECISION_LABEL = /^(decision|architecture|adr)$/i;

/** 08 §2.1 (optional): merged PRs with long descriptions or decision labels → decision drafts. */
export async function prCandidates(
  gh: GhRunner | undefined,
  root: string,
): Promise<{ candidates: AdoptCandidate[]; skip?: AdoptSkip }> {
  if (!gh) return { candidates: [], skip: { evidence: "prs", reason: "gh is not available" } };
  const r = await gh(
    ["pr", "list", "--state", "merged", "--limit", "100", "--json", "number,title,body,labels,url"],
    root,
  ).catch((e: unknown) => ({ code: 1, stdout: "", stderr: e instanceof Error ? e.message : String(e) }));
  if (r.code !== 0)
    return {
      candidates: [],
      skip: { evidence: "prs", reason: `gh failed: ${r.stderr.trim().split("\n")[0]}` },
    };
  let prs: Pr[];
  try {
    prs = JSON.parse(r.stdout) as Pr[];
  } catch {
    return { candidates: [], skip: { evidence: "prs", reason: "gh returned output that is not JSON" } };
  }
  const candidates = prs
    .filter(
      (p) => (p.labels ?? []).some((l) => DECISION_LABEL.test(l.name)) || (p.body ?? "").trim().length >= 500,
    )
    .sort((a, b) => a.number - b.number)
    .map((p): AdoptCandidate => {
      const body = (p.body ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 4000);
      const title = p.title.replace(/[*_`]/g, "").trim().slice(0, 120);
      return {
        source: "prs",
        type: "decision",
        title,
        summary: firstSentence(body.replace(/^#+\s.*$/gm, "")) || title,
        body: [
          `## Context\n\n${body || "_The pull request has no description._"}`,
          `## Decision\n\nMerged in #${p.number}: ${title}.`,
          "## Consequences\n\n_Not stated in the pull request._",
        ].join("\n\n"),
        status: "accepted",
        tags: ["adopted"],
        evidence: [p.url],
      };
    });
  return { candidates };
}
