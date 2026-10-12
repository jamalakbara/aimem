import { dirname, join, resolve } from "node:path";
import { PROJECT_DEFAULTS, type ProjectConfig, projectSchema, SPEC_VERSION } from "@aimem/schema";
import YAML from "yaml";
import { AimemError } from "../errors.js";
import type { Fs } from "../ports.js";

export const AIMEM_DIR = ".aimem";

/** project.yaml with the defaults tools rely on filled in (03 §6). */
export type ResolvedProject = ProjectConfig & {
  mode: NonNullable<ProjectConfig["mode"]>;
  sync: NonNullable<ProjectConfig["sync"]>;
  roles: string[];
  freshness_days: Record<string, number>;
};

export interface Notebook {
  /** Folder containing `.aimem/`. */
  root: string;
  /** The `.aimem/` folder. */
  dir: string;
  config: ResolvedProject;
}

async function exists(fs: Fs, path: string): Promise<boolean> {
  try {
    await fs.readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** Nearest folder at or above `start` that contains `.aimem/project.yaml`, or null. */
export async function findNotebook(fs: Fs, start: string): Promise<string | null> {
  let cur = resolve(start);
  for (;;) {
    if (await exists(fs, join(cur, AIMEM_DIR, "project.yaml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function resolveProject(config: ProjectConfig): ResolvedProject {
  return {
    ...config,
    mode: config.mode ?? PROJECT_DEFAULTS.mode,
    sync: config.sync ?? PROJECT_DEFAULTS.sync,
    roles: config.roles ?? [...PROJECT_DEFAULTS.roles],
    freshness_days: { ...PROJECT_DEFAULTS.freshness_days, ...config.freshness_days },
  };
}

export async function loadProject(fs: Fs, start: string): Promise<Notebook> {
  const root = await findNotebook(fs, start);
  if (!root) throw new AimemError("NOT_INITIALIZED", "No .aimem/ found. Run `aimem init` in your repo.");
  const dir = join(root, AIMEM_DIR);
  const doc = YAML.parseDocument(await fs.readFile(join(dir, "project.yaml")));
  if (doc.errors.length) {
    throw new AimemError(
      "INVALID_RECORD",
      `project.yaml: invalid YAML (${doc.errors[0]?.message.split("\n")[0]})`,
    );
  }
  const raw: unknown = doc.toJS();
  const version = (raw as { aimem?: unknown } | null)?.aimem;
  if (typeof version === "number" && version > SPEC_VERSION) {
    throw new AimemError(
      "SPEC_TOO_NEW",
      `project.yaml uses spec v${version}; this tool supports v${SPEC_VERSION}`,
    );
  }
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new AimemError("INVALID_RECORD", `project.yaml: ${why}`);
  }
  return { root, dir, config: resolveProject(parsed.data) };
}
