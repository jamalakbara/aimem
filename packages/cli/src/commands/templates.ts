import { isAbsolute, relative, resolve } from "node:path";
import { AimemError, loadProject, resolveAuthorWithGit, SHEET_COLUMNS } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

type SheetName = keyof typeof SHEET_COLUMNS;
const SHEETS = Object.keys(SHEET_COLUMNS) as SheetName[];

/** 16 §4.2 document templates: the headings `aimem import` recognises. */
const DOCS: Record<string, string[]> = {
  decision: ["Summary", "Status", "Context", "Decision", "Consequences", "Alternatives"],
  runbook: ["Summary", "When to use", "Steps", "Rollback", "Verify"],
  incident: ["Summary", "Severity", "Impact", "Timeline", "Root cause", "Fix", "Prevention"],
  memory: ["Summary"],
};
const HINT: Record<string, string> = {
  Summary: "One or two sentences that say what this is.",
  Status: "proposed, accepted, rejected, superseded or deprecated",
  Severity: "sev1, sev2, sev3 or sev4",
};

const docTemplate = (name: string) =>
  [
    `# ${name[0]?.toUpperCase()}${name.slice(1)} title`,
    "",
    "Roles: ",
    "Tags: ",
    "",
    ...(DOCS[name] ?? []).flatMap((h) => [`## ${h}`, "", HINT[h] ?? "Write this part here.", ""]),
  ].join("\n");

/** `aimem templates list | export <name> --format csv|md [--out <path>]` (16 §4). */
export async function templates(
  deps: CliDeps,
  g: GlobalOptions,
  args: string[],
  o: { format?: string; out?: string; force?: boolean; allowOutside?: boolean; author?: string },
): Promise<CommandResult> {
  const [sub, name] = args;
  if (sub === "list" || sub === undefined) {
    const list = [
      ...SHEETS.map((n) => ({ name: n, kind: "sheet", formats: ["csv"] })),
      ...Object.keys(DOCS).map((n) => ({ name: n, kind: "document", formats: ["md"] })),
    ];
    return {
      data: { templates: list },
      text: `${list.map((t) => `${t.name.padEnd(10)} ${t.kind.padEnd(9)} ${t.formats.join(", ")}`).join("\n")}\n`,
    };
  }
  if (sub !== "export")
    throw new AimemError("USAGE", "use aimem templates list or aimem templates export <name>");
  if (!name) throw new AimemError("USAGE", "name a template: aimem templates export <name> --format csv|md");
  const format = (o.format ?? (SHEETS.includes(name as SheetName) ? "csv" : "md")).toLowerCase();
  if (format === "xlsx")
    throw new AimemError("USAGE", "xlsx templates arrive in a later M4b slice; use --format csv");
  let content: string;
  if (SHEETS.includes(name as SheetName)) {
    if (format !== "csv") throw new AimemError("USAGE", `${name} is a sheet template: use --format csv`);
    content = `${SHEET_COLUMNS[name as SheetName].join(",")}\n`;
  } else if (DOCS[name]) {
    if (format !== "md") throw new AimemError("USAGE", `${name} is a document template: use --format md`);
    content = docTemplate(name);
  } else
    throw new AimemError(
      "USAGE",
      `unknown template '${name}' (expected one of: ${[...SHEETS, ...Object.keys(DOCS)].join(", ")})`,
    );
  if (!o.out) return { data: { name, format, content }, text: content };
  const path = resolve(deps.cwd, o.out);
  // Never overwrite by accident, and keep an agent inside the project (QA, #100).
  const exists = await deps.fs.readBytes(path).then(
    () => true,
    () => false,
  );
  if (exists && !o.force)
    throw new AimemError("USAGE", `${o.out} already exists; pass --force to overwrite it`);
  const author = await resolveAuthorWithGit({
    ...(o.author ? { flag: o.author } : {}),
    env: deps.env,
    git: deps.git,
    cwd: g.dir,
  }).catch(() => "");
  if (author.startsWith("agent:") && !o.allowOutside) {
    const nb = await loadProject(deps.fs, g.dir);
    const rel = relative(nb.root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new AimemError(
        "USAGE",
        `${o.out} is outside the project; an agent writes there only with --allow-outside`,
      );
  }
  await deps.fs.writeFile(path, content);
  return { data: { name, format, out: path }, text: `Wrote the ${name} template to ${o.out}.\n` };
}
