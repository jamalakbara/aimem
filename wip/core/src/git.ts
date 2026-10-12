import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string | null {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}
export interface GitSignals { branch?: string; changed: string[]; userName?: string }
export function gitSignals(cwd: string): GitSignals {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined;
  const diff = git(cwd, ["diff", "--name-only", "HEAD"]) ?? "";
  const status = git(cwd, ["status", "--porcelain"]) ?? "";
  const files = new Set<string>();
  for (const l of diff.split("\n")) if (l) files.add(l);
  for (const l of status.split("\n")) { const f = l.slice(3).trim(); if (f && !f.startsWith(".aimem/")) files.add(f); }
  return { branch: branch === "HEAD" ? undefined : branch, changed: [...files], userName: git(cwd, ["config", "user.name"]) ?? undefined };
}
export function resolveAuthor(flag: string | undefined, cwd: string): string {
  if (flag) return flag;
  if (process.env.AIMEM_AUTHOR) return process.env.AIMEM_AUTHOR;
  const n = git(cwd, ["config", "user.name"]);
  return `human:${(n || process.env.USER || "unknown").toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}
export { git as gitRun };
