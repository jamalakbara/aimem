import { basename, join } from "node:path";
import { AimemError, loadIndex, loadProject, slugify, writeFileAtomic, writeIndexMd } from "@aimem/core";
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

export async function init(
  deps: CliDeps,
  g: GlobalOptions,
  o: {
    solo?: boolean;
    team?: boolean;
    project?: string;
    repo?: string;
    roles?: string;
    force?: boolean;
    intake: boolean;
  },
): Promise<CommandResult> {
  const root = g.dir;
  const aimem = join(root, ".aimem");
  if (o.solo && o.team) throw new AimemError("USAGE", "choose either --solo or --team");
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
  const team = Boolean(o.team);
  const warnings = team
    ? ["team mode: the aimem-live branch and claims arrive in M3; sync is set to git"]
    : [];

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
    `sync: ${team ? "git" : "none"}`,
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
  const nb = await loadProject(deps.fs, root);
  if (await writeIndexMd(deps.fs, nb, await loadIndex(nb, { fs: deps.fs }), deps.random))
    files.push(".aimem/INDEX.md");
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
