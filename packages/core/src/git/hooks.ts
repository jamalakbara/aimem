import { isAbsolute, join } from "node:path";
import { AimemError } from "../errors.js";
import type { Fs } from "../ports.js";
import type { Git } from "./git.js";

/** Hooks that run after a merge, checkout or rebase changes `.aimem/` (07 §1 rule 5). */
export const INDEX_HOOKS = ["post-merge", "post-checkout", "post-rewrite"] as const;
const BEGIN = "# >>> aimem: regenerate .aimem/INDEX.md >>>";
const END = "# <<< aimem <<<";
const BLOCK = [
  BEGIN,
  "if command -v aimem >/dev/null 2>&1; then aimem index --quiet >/dev/null 2>&1 || true; fi",
  END,
].join("\n");
const ATTRIBUTE = ".aimem/INDEX.md merge=ours";

export interface HookState {
  /** Hooks that contain the aimem block. */
  installed: string[];
  /** `merge.ours.driver` is set, so `merge=ours` in .gitattributes takes effect. */
  mergeDriver: boolean;
  /** `.gitattributes` marks INDEX.md as `merge=ours`. */
  attribute: boolean;
}

async function hooksDir(git: Git, root: string): Promise<string> {
  const r = await git.run(["rev-parse", "--git-path", "hooks"], root);
  if (r.code !== 0) throw new AimemError("USAGE", "not a git repository; hooks need one");
  const dir = r.stdout.trim();
  return isAbsolute(dir) ? dir : join(root, dir);
}

function withoutBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return `${text.slice(0, start)}${text.slice(end + END.length)}`.replace(/\n{3,}/g, "\n\n");
}

export async function hookState(git: Git, fs: Fs, root: string): Promise<HookState> {
  const dir = await hooksDir(git, root).catch(() => undefined);
  const installed: string[] = [];
  if (dir) {
    for (const hook of INDEX_HOOKS) {
      const text = await fs.readFile(join(dir, hook)).catch(() => "");
      if (text.includes(BEGIN)) installed.push(hook);
    }
  }
  const driver = await git.run(["config", "--get", "merge.ours.driver"], root);
  const attrs = await fs.readFile(join(root, ".gitattributes")).catch(() => "");
  return {
    installed,
    mergeDriver: driver.code === 0 && driver.stdout.trim() !== "",
    attribute: attrs.split(/\r?\n/).some((l) => l.trim() === ATTRIBUTE),
  };
}

/**
 * Install the INDEX.md handling from 07 §1: hooks that run `aimem index` after merges, checkouts
 * and rewrites, the `merge.ours` driver that `.gitattributes` relies on, and the attribute itself.
 * Existing hook content outside the aimem block is kept. Idempotent.
 */
export async function installIndexHooks(git: Git, fs: Fs, root: string): Promise<{ changed: string[] }> {
  const dir = await hooksDir(git, root);
  await fs.mkdir(dir);
  const changed: string[] = [];
  for (const hook of INDEX_HOOKS) {
    const path = join(dir, hook);
    const old = await fs.readFile(path).catch(() => null);
    // Same layout every time, so a second install changes nothing.
    const base = `${(old === null ? "#!/bin/sh" : withoutBlock(old)).replace(/\s*$/, "")}\n`;
    const next = `${base}${base === "#!/bin/sh\n" ? "" : "\n"}${BLOCK}\n`;
    if (next !== old) {
      await fs.writeFile(path, next);
      changed.push(hook);
    }
    await fs.chmod?.(path, 0o755);
  }
  const driver = await git.run(["config", "--get", "merge.ours.driver"], root);
  if (driver.code !== 0 || !driver.stdout.trim()) {
    const set = await git.run(["config", "merge.ours.driver", "true"], root);
    if (set.code !== 0) throw new AimemError("USAGE", "could not set git config merge.ours.driver");
    changed.push("git config merge.ours.driver");
  }
  const attrsPath = join(root, ".gitattributes");
  const attrs = await fs.readFile(attrsPath).catch(() => "");
  if (!attrs.split(/\r?\n/).some((l) => l.trim() === ATTRIBUTE)) {
    await fs.writeFile(attrsPath, `${attrs}${attrs && !attrs.endsWith("\n") ? "\n" : ""}${ATTRIBUTE}\n`);
    changed.push(".gitattributes");
  }
  return { changed };
}

/** Remove only the aimem block; a hook that held nothing else is deleted. */
export async function uninstallIndexHooks(git: Git, fs: Fs, root: string): Promise<{ changed: string[] }> {
  const dir = await hooksDir(git, root);
  const changed: string[] = [];
  for (const hook of INDEX_HOOKS) {
    const path = join(dir, hook);
    const old = await fs.readFile(path).catch(() => null);
    if (old === null || !old.includes(BEGIN)) continue;
    const rest = withoutBlock(old);
    if (rest.trim() === "" || rest.trim() === "#!/bin/sh") await fs.unlink(path);
    else await fs.writeFile(path, rest.replace(/\n*$/, "\n"));
    changed.push(hook);
  }
  return { changed };
}
