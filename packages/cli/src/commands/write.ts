import { resolve } from "node:path";
import {
  AimemError,
  addRecord,
  loadProject,
  resolveAuthor,
  supersedeRecord,
  updateRecord,
  verifyRecords,
} from "@aimem/core";
import { RECORD_TYPES, type RecordType } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

interface BodyOptions {
  body?: string;
  bodyFile?: string;
}

/** `--body text`, `--body -` (stdin) or `--body-file path` (04 §4). */
async function readBody(deps: CliDeps, o: BodyOptions): Promise<string | undefined> {
  if (o.body !== undefined && o.bodyFile !== undefined)
    throw new AimemError("USAGE", "use either --body or --body-file, not both");
  if (o.body === "-") return deps.stdin();
  if (o.body !== undefined) return o.body;
  if (o.bodyFile !== undefined) {
    const path = resolve(deps.cwd, o.bodyFile);
    return deps.fs.readFile(path).catch(() => {
      throw new AimemError("USAGE", `cannot read --body-file ${o.bodyFile}`);
    });
  }
  return undefined;
}

const author = (deps: CliDeps, o: { author?: string }) =>
  resolveAuthor({ ...(o.author ? { flag: o.author } : {}), env: deps.env });
const writeDeps = (deps: CliDeps) => ({ fs: deps.fs, clock: deps.clock, random: deps.random });

export interface AddOptions extends BodyOptions {
  title: string;
  summary: string;
  status?: string;
  roles?: string;
  tags?: string;
  paths?: string;
  link?: string[];
  supersedes?: string;
  kind?: string;
  priority?: string;
  assignee?: string;
  force?: boolean;
  author?: string;
}

export async function add(
  deps: CliDeps,
  g: GlobalOptions,
  type: string,
  o: AddOptions,
): Promise<CommandResult> {
  if (!(RECORD_TYPES as readonly string[]).includes(type))
    throw new AimemError("USAGE", `unknown type '${type}' (expected one of: ${RECORD_TYPES.join(", ")})`);
  const who = author(deps, o);
  const nb = await loadProject(deps.fs, g.dir);
  const body = await readBody(deps, o);
  const roles = csv(o.roles);
  const tags = csv(o.tags);
  const paths = csv(o.paths);
  const fields = Object.fromEntries(
    (["kind", "priority", "assignee"] as const).flatMap((k) => (o[k] !== undefined ? [[k, o[k]]] : [])),
  );
  const r = await addRecord(
    nb,
    {
      type: type as RecordType,
      title: o.title,
      summary: o.summary,
      author: who,
      ...(body !== undefined ? { body } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(roles ? { roles } : {}),
      ...(tags ? { tags } : {}),
      ...(paths ? { paths } : {}),
      ...(o.link?.length ? { links: o.link } : {}),
      ...(o.supersedes ? { supersedes: o.supersedes } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
      ...(o.force ? { force: true } : {}),
    },
    writeDeps(deps),
  );
  return {
    data: { ref: r.ref, type: r.type, status: r.status, trust: r.trust, file: r.file, changed: r.changed },
    text: `Added ${r.ref} (${r.type}, ${r.status}, ${r.trust}) → ${r.file}\n`,
    warnings: r.warnings,
  };
}

export async function update(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: BodyOptions & { set?: string[]; force?: boolean; author?: string },
): Promise<CommandResult> {
  const who = author(deps, o);
  const set: Record<string, string> = {};
  for (const pair of o.set ?? []) {
    const i = pair.indexOf("=");
    if (i < 1) throw new AimemError("USAGE", `--set expects key=value (got '${pair}')`);
    set[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
  const nb = await loadProject(deps.fs, g.dir);
  const body = await readBody(deps, o);
  const r = await updateRecord(
    nb,
    ref,
    { set, author: who, ...(body !== undefined ? { body } : {}), ...(o.force ? { force: true } : {}) },
    writeDeps(deps),
  );
  return { data: { ref: r.ref, file: r.file, changed: r.changed }, text: `Updated ${r.ref} → ${r.file}\n` };
}

export async function supersede(
  deps: CliDeps,
  g: GlobalOptions,
  oldRef: string,
  o: { by: string },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const r = await supersedeRecord(nb, oldRef, o.by, writeDeps(deps));
  return {
    data: { old: r.old, new: r.ref, changed: r.changed },
    text: `${r.old} is now superseded by ${r.ref}\n`,
  };
}

export async function verify(
  deps: CliDeps,
  g: GlobalOptions,
  refs: string[],
  o: { author?: string },
): Promise<CommandResult> {
  const who = author(deps, o);
  const nb = await loadProject(deps.fs, g.dir);
  const r = await verifyRecords(nb, refs, who, writeDeps(deps));
  return { data: r, text: `Verified ${r.refs.join(", ")}\n` };
}
