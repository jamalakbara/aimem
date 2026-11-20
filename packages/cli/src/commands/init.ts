import { basename, join } from "node:path";
import { defaultTargets, syncAdapters, TARGET_NAMES, type TargetName } from "@aimem/adapters";
import {
  AimemError,
  ensureLiveBranch,
  loadIndex,
  loadProject,
  type Notebook,
  setProjectValue,
  slugify,
  writeFileAtomic,
  writeIndexMd,
} from "@aimem/core";
import { PROJECT_DEFAULTS, PROJECT_SLUG_RE, RECORD_TYPES, TYPE_DIR } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

/** 08 §1.1. Emitted so an agent can ask the human, then create the records with `aimem add`. */
export const INTAKE = [
  {
    id: 1,
    question: "What is this project, who uses it, what does success look like?",
    creates: 'memory (kind fact, tag pinned, title "Project overview")',
  },
  {
    id: 2,
    question: "Stack and key libraries; how to run, test, deploy locally?",
    creates: 'memory (kind howto, tag pinned, title "How to run and test")',
  },
  {
    id: 3,
    question: "Conventions agents must follow (style, branching, PR rules, forbidden actions)?",
    creates: 'memory (kind preference, tag pinned, title "Conventions")',
  },
  {
    id: 4,
    question: "Major decisions already made and why (database, framework, hosting)?",
    creates: "one decision each (status accepted)",
  },
  { id: 5, question: "What are the first tasks / milestones?", creates: "task records" },
  { id: 6, question: "Who does what (roles, handles)?", creates: "members in project.yaml" },
  {
    id: 7,
    question: "Known external systems and their gotchas (payment, ads APIs, ...)?",
    creates: "memory (kind gotcha) each",
  },
];

const yamlScalar = (s: string) =>
  /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(s) && !/^(true|false|null|yes|no|\d+)$/i.test(s)
    ? s
    : JSON.stringify(s);

async function readOrNull(deps: CliDeps, path: string): Promise<string | null> {
  return deps.fs.readFile(path).catch(() => null);
}

const UPGRADE = "aimem init --upgrade --sync git";

async function hasOrigin(deps: CliDeps, root: string): Promise<boolean> {
  const remotes = await deps.git.run(["remote"], root);
  return remotes.code === 0 && remotes.stdout.split(/\r?\n/).includes("origin");
}

async function setupGitSync(deps: CliDeps, root: string, offline?: boolean): Promise<string[]> {
  if (offline) return [`aimem-live setup is pending. Run ${UPGRADE} online.`];
  await ensureLiveBranch(deps.git, root);
  return [];
}

function missingOrigin(): AimemError {
  return new AimemError("SYNC_FAILED", "Git sync requires an origin remote. Configure origin and retry.");
}

async function refreshIndex(deps: CliDeps, nb: Notebook, files: string[]): Promise<void> {
  if (await writeIndexMd(deps.fs, nb, await loadIndex(nb, { fs: deps.fs }), deps.random))
    files.push(".aimem/INDEX.md");
}

async function upgradeGitSync(deps: CliDeps, start: string, offline?: boolean): Promise<CommandResult> {
  let nb = await loadProject(deps.fs, start);
  if (nb.config.mode !== "team" || nb.config.sync === "server") {
    throw new AimemError("USAGE", "--upgrade --sync git requires a team notebook with none or git sync");
  }
  if (!(await hasOrigin(deps, nb.root))) throw missingOrigin();
  const warnings = await setupGitSync(deps, nb.root, offline);
  const files: string[] = [];
  if (nb.config.sync !== "git") {
    await setProjectValue(deps.fs, nb, ["sync"], "git", deps.random);
    files.push(".aimem/project.yaml");
    nb = await loadProject(deps.fs, nb.root);
  }
  await refreshIndex(deps, nb, files);
  return {
    data: { project: nb.config.project, mode: nb.config.mode, files: files.sort() },
    text: `Configured Git sync for '${nb.config.project}' in ${nb.root}\n`,
    warnings,
  };
}

export async function init(
  deps: CliDeps,
  g: GlobalOptions,
  o: {
    solo?: boolean;
    team?: boolean;
    sync?: "none" | "git";
    offline?: boolean;
    upgrade?: boolean;
    project?: string;
    repo?: string;
    roles?: string;
    force?: boolean;
    intake: boolean;
    adapters?: string;
  },
): Promise<CommandResult> {
  const root = g.dir;
  const aimem = join(root, ".aimem");
  if (o.solo && o.team) throw new AimemError("USAGE", "choose either --solo or --team");
  if (o.upgrade) {
    const otherSetupOptions = [o.project, o.repo, o.roles, o.adapters].some((value) => value !== undefined);
    if (o.sync !== "git" || o.solo || o.team || o.force || otherSetupOptions) {
      throw new AimemError("USAGE", "--upgrade requires --sync git and cannot change other setup options");
    }
    return upgradeGitSync(deps, root, o.offline);
  }
  if (o.sync === "git" && !o.team) throw new AimemError("USAGE", "--sync git requires --team");
  if (!o.force && (await readOrNull(deps, join(aimem, "project.yaml"))) !== null) {
    throw new AimemError(
      "USAGE",
      ".aimem/ already exists here; pass --force to re-create project.yaml (records are never touched)",
    );
  }
  const project = o.project ?? slugify(basename(root));
  if (!PROJECT_SLUG_RE.test(project))
    throw new AimemError("USAGE", `project slug must be lowercase kebab-case (got '${project}')`);
  const roles = o.roles
    ? o.roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : [...PROJECT_DEFAULTS.roles];
  if (!roles.length) throw new AimemError("USAGE", "--roles needs at least one role");
  let targets: TargetName[] | undefined;
  if (o.adapters !== undefined) {
    const names =
      o.adapters === "none"
        ? []
        : o.adapters
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
    for (const n of names) {
      if (!(TARGET_NAMES as string[]).includes(n))
        throw new AimemError("USAGE", `unknown adapter target '${n}' (known: ${TARGET_NAMES.join(", ")})`);
    }
    targets = names as TargetName[];
  }

  const team = Boolean(o.team);
  let sync: "none" | "git" = "none";
  let warnings: string[] = [];
  if (team && o.sync !== "none") {
    if (await hasOrigin(deps, root)) {
      sync = "git";
      warnings = await setupGitSync(deps, root, o.offline);
    } else if (o.sync === "git") {
      throw missingOrigin();
    } else {
      warnings.push(`No origin remote configured. To enable Git sync, configure origin and run ${UPGRADE}.`);
    }
  }

  const files: string[] = [];
  const write = async (rel: string, data: string) => {
    await writeFileAtomic(deps.fs, join(root, rel), data, deps.random);
    files.push(rel);
  };
  const yaml = [
    "aimem: 1",
    `project: ${project}`,
    `name: ${yamlScalar(basename(root))}`,
    `mode: ${team ? "team" : "solo"}`,
    `sync: ${sync}`,
    ...(o.repo ? [`repo: ${yamlScalar(o.repo)}`] : []),
    `roles: [${roles.map(yamlScalar).join(", ")}]`,
  ].join("\n");
  await write(".aimem/project.yaml", `${yaml}\n`);
  for (const t of RECORD_TYPES) {
    const rel = `.aimem/${TYPE_DIR[t]}/.gitkeep`;
    if ((await readOrNull(deps, join(root, rel))) === null) await write(rel, "");
  }
  for (const [file, line] of [
    [".gitignore", ".aimem/.cache/"],
    [".gitattributes", ".aimem/INDEX.md merge=ours"],
  ] as const) {
    const current = await readOrNull(deps, join(root, file));
    if (current?.split(/\r?\n/).includes(line)) continue;
    const prefix = current ? (current.endsWith("\n") ? current : `${current}\n`) : "";
    await write(file, `${prefix}${line}\n`);
  }
  let nb = await loadProject(deps.fs, root);
  // Adapters (08 §1 step 4): default AGENTS.md, plus CLAUDE.md when it exists without importing AGENTS.md.
  targets ??= await defaultTargets(nb, deps.fs);
  await setProjectValue(deps.fs, nb, ["adapters", "targets"], targets, deps.random);
  nb = await loadProject(deps.fs, root);
  for (const r of await syncAdapters(nb, { fs: deps.fs, random: deps.random }, { targets })) {
    if (r.action === "created" || r.action === "updated") files.push(r.file);
    if (r.action === "broken") warnings.push(`${r.file}: ${r.note}; not changed`);
  }
  await refreshIndex(deps, nb, files);
  files.sort();

  const text = [
    `Initialised aimem notebook '${project}' (${team ? "team" : "solo"}) in ${root}`,
    ...files.map((f) => `  ${f}`),
    ...(o.intake
      ? [
          "",
          "Next: answer these to create the first records (aimem add …):",
          ...INTAKE.map((q) => `  ${q.id}. ${q.question} → ${q.creates}`),
        ]
      : []),
  ].join("\n");
  return {
    data: { project, mode: team ? "team" : "solo", files, ...(o.intake ? { intake: INTAKE } : {}) },
    text: `${text}\n`,
    warnings,
  };
}
