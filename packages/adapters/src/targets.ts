import { join, relative, resolve } from "node:path";
import { AimemError, type Fs, type Notebook, type Random, toPosix, writeFileAtomic } from "@aimem/core";
import { inspectBlock, removeBlock, upsertBlock } from "./block.js";

/** 06 §4 targets. File names are conventions owned by each tool; verify when updating. */
export const TARGETS = {
  agents: { file: "AGENTS.md", kind: "markdown" },
  claude: { file: "CLAUDE.md", kind: "markdown" },
  cursor: { file: ".cursor/rules/aimem.mdc", kind: "cursor" },
  copilot: { file: ".github/copilot-instructions.md", kind: "markdown" },
  gemini: { file: "GEMINI.md", kind: "markdown" },
} as const;

export type TargetName = keyof typeof TARGETS;
export const TARGET_NAMES = Object.keys(TARGETS) as TargetName[];

/** Cursor rule files carry frontmatter; aimem owns the whole `aimem.mdc`. */
export const CURSOR_HEADER = "---\ndescription: aimem project memory protocol\nalwaysApply: true\n---\n\n";

const IMPORTS_AGENTS = /^@AGENTS\.md\s*$/m;

export interface AdapterResult {
  target: TargetName | "file";
  file: string;
  action: "created" | "updated" | "unchanged" | "skipped" | "broken" | "removed" | "deleted" | "absent";
  note?: string;
}

export interface AdapterSelection {
  targets?: TargetName[];
  /** Extra files (`aimem adapters add --file`), relative to the repository root. */
  files?: string[];
}

interface Entry {
  target: TargetName | "file";
  file: string;
  prefix: string;
}

const read = (fs: Fs, path: string) => fs.readFile(path).catch(() => null);

/** AGENTS.md always; CLAUDE.md too when it exists and does not import AGENTS.md (human decision, slice 2.5). */
export async function defaultTargets(nb: Notebook, fs: Fs): Promise<TargetName[]> {
  const claude = await read(fs, join(nb.root, TARGETS.claude.file));
  return claude !== null && !IMPORTS_AGENTS.test(claude) ? ["agents", "claude"] : ["agents"];
}

async function entries(
  nb: Notebook,
  fs: Fs,
  sel: AdapterSelection,
  fallback: "config" | "all",
): Promise<Entry[]> {
  const configured = nb.config.adapters as { targets?: TargetName[]; files?: string[] } | undefined;
  const targets =
    sel.targets ??
    (fallback === "all" ? TARGET_NAMES : (configured?.targets ?? (await defaultTargets(nb, fs))));
  const files = sel.files ?? configured?.files ?? [];
  for (const f of files) {
    const rel = relative(nb.root, resolve(nb.root, f));
    if (rel.startsWith("..") || resolve(nb.root, f) === nb.root) {
      throw new AimemError("USAGE", `adapter file ${f} must be inside the repository`);
    }
  }
  return [
    ...targets.map((t) => ({
      target: t,
      file: TARGETS[t].file,
      prefix: TARGETS[t].kind === "cursor" ? CURSOR_HEADER : "",
    })),
    ...files.map((f) => ({
      target: "file" as const,
      file: toPosix(relative(nb.root, resolve(nb.root, f))),
      prefix: "",
    })),
  ];
}

/** `aimem adapters sync`: write or refresh the managed block in each target (06 §4). */
export async function syncAdapters(
  nb: Notebook,
  deps: { fs: Fs; random: Random },
  sel: AdapterSelection = {},
): Promise<AdapterResult[]> {
  const out: AdapterResult[] = [];
  for (const e of await entries(nb, deps.fs, sel, "config")) {
    const path = join(nb.root, e.file);
    const text = await read(deps.fs, path);
    if (e.target === "claude" && text !== null && IMPORTS_AGENTS.test(text)) {
      out.push({ target: e.target, file: e.file, action: "skipped", note: "imports AGENTS.md" });
      continue;
    }
    if (text !== null && inspectBlock(text).state === "broken") {
      out.push({
        target: e.target,
        file: e.file,
        action: "broken",
        note: inspectBlock(text).problem ?? "broken block",
      });
      continue;
    }
    const next = upsertBlock(text, e.prefix);
    if (next === text) {
      out.push({ target: e.target, file: e.file, action: "unchanged" });
      continue;
    }
    await writeFileAtomic(deps.fs, path, next, deps.random);
    out.push({ target: e.target, file: e.file, action: text === null ? "created" : "updated" });
  }
  return out;
}

/** `aimem adapters remove`: take the block out; delete files that held only aimem content. */
export async function removeAdapters(
  nb: Notebook,
  deps: { fs: Fs; random: Random },
  sel: AdapterSelection = {},
): Promise<AdapterResult[]> {
  const out: AdapterResult[] = [];
  for (const e of await entries(nb, deps.fs, sel, "all")) {
    const path = join(nb.root, e.file);
    const text = await read(deps.fs, path);
    if (text === null || inspectBlock(text).state === "missing") {
      if (sel.targets || e.target === "file" || text !== null)
        out.push({ target: e.target, file: e.file, action: "absent" });
      continue;
    }
    if (inspectBlock(text).state === "broken") {
      out.push({
        target: e.target,
        file: e.file,
        action: "broken",
        note: inspectBlock(text).problem ?? "broken block",
      });
      continue;
    }
    const next = removeBlock(text, e.prefix);
    if (next === null) {
      await deps.fs.unlink(path);
      out.push({ target: e.target, file: e.file, action: "deleted" });
    } else {
      await writeFileAtomic(deps.fs, path, next, deps.random);
      out.push({ target: e.target, file: e.file, action: "removed" });
    }
  }
  return out;
}

export interface AdapterStatus {
  target: TargetName | "file";
  file: string;
  state: "missing" | "current" | "outdated" | "broken" | "via AGENTS.md";
}

/** `aimem adapters list` and `doctor`. */
export async function adapterStatus(
  nb: Notebook,
  fs: Fs,
  sel: AdapterSelection = {},
): Promise<AdapterStatus[]> {
  const out: AdapterStatus[] = [];
  for (const e of await entries(nb, fs, sel, "config")) {
    const text = await read(fs, join(nb.root, e.file));
    if (e.target === "claude" && text !== null && IMPORTS_AGENTS.test(text))
      out.push({ target: e.target, file: e.file, state: "via AGENTS.md" });
    else
      out.push({
        target: e.target,
        file: e.file,
        state: text === null ? "missing" : inspectBlock(text).state,
      });
  }
  return out;
}
