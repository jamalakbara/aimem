import type { AdoptCandidate } from "./types.js";

/** Reads a project file as text; `undefined` when absent, too large or binary (the caller reports why). */
export type ReadText = (path: string) => Promise<string | undefined>;

const sortPaths = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

const STACK_FILES = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
];

/** 08 §2.1: package manifests, Dockerfile and compose → stack facts (one memory, kind fact). */
export async function stackCandidate(
  files: readonly string[],
  read: ReadText,
): Promise<AdoptCandidate | undefined> {
  const lines: string[] = [];
  const evidence: string[] = [];
  const items: string[] = [];
  for (const path of STACK_FILES.filter((f) => files.includes(f))) {
    const text = await read(path);
    if (text === undefined) continue;
    let line: string | undefined;
    if (path === "package.json") {
      try {
        const pkg = JSON.parse(text) as Record<string, unknown>;
        const keys = (v: unknown) => (v && typeof v === "object" ? Object.keys(v).sort() : []);
        const deps = keys(pkg.dependencies);
        const dev = keys(pkg.devDependencies);
        const parts = [
          ...(deps.length ? [`dependencies ${deps.join(", ")}`] : []),
          ...(dev.length ? [`dev dependencies ${dev.join(", ")}`] : []),
        ];
        line = `\`package.json\`${typeof pkg.name === "string" ? ` (${pkg.name})` : ""}: ${parts.join("; ") || "no dependencies"}`;
        items.push(...deps);
      } catch {
        continue;
      }
    } else if (path === "pyproject.toml") {
      const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
      const block = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text)?.[1] ?? "";
      const deps = [...block.matchAll(/["']([A-Za-z0-9_.-]+)/g)].map((m) => m[1] ?? "").filter(Boolean);
      line = `\`pyproject.toml\`${name ? ` (${name})` : ""}: ${deps.length ? `dependencies ${deps.join(", ")}` : "no dependencies listed"}`;
      items.push(...deps);
    } else if (path === "go.mod") {
      const mod = /^module\s+(\S+)/m.exec(text)?.[1];
      const go = /^go\s+(\S+)/m.exec(text)?.[1];
      if (!mod) continue;
      line = `\`go.mod\`: module ${mod}${go ? `, Go ${go}` : ""}`;
      items.push(`Go ${go ?? ""}`.trim());
    } else if (path === "Dockerfile") {
      const images = uniq([...text.matchAll(/^\s*FROM\s+(\S+)/gim)].map((m) => m[1] ?? "").filter(Boolean));
      if (!images.length) continue;
      line = `\`Dockerfile\`: base image ${images.join(", ")}`;
      items.push(...images);
    } else {
      const services = /^services:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(text)?.[1] ?? "";
      const names = [...services.matchAll(/^ {2}([A-Za-z0-9_.-]+):/gm)].map((m) => m[1] ?? "");
      if (!names.length) continue;
      line = `\`${path}\`: services ${names.join(", ")}`;
    }
    lines.push(`- ${line}`);
    evidence.push(path);
  }
  if (!lines.length) return undefined;
  evidence.sort(sortPaths);
  const shown = uniq(items).slice(0, 6);
  return {
    source: "readme",
    type: "memory",
    title: "Tech stack",
    summary: `Stack from ${evidence.join(", ")}${shown.length ? `: ${shown.join(", ")}` : ""}.`.slice(0, 200),
    body: lines.join("\n"),
    kind: "fact",
    tags: ["adopted"],
    evidence,
  };
}

const MIGRATION_DIR = /^(?:db\/)?migrat(?:e|ions?)\/|^(?:supabase|prisma)\/migrations\/|^sql\/migrations\//i;
const CONSTRAINT = /^(?:primary|unique|foreign|constraint|check|key|index|exclude)\b/i;

/** Splits on commas outside parentheses. */
function topLevelParts(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const bareName = (n: string) => (n.split(".").pop() ?? n).replace(/^["'`[]|["'`\]]$/g, "");

/** 08 §2.1: SQL migrations → one `schema` record (tables, columns, comments, the migration list). */
export async function schemaCandidate(
  files: readonly string[],
  read: ReadText,
): Promise<AdoptCandidate | undefined> {
  const migrations = files.filter((f) => MIGRATION_DIR.test(f) && /\.sql$/i.test(f)).sort(sortPaths);
  const tables = new Map<string, string[]>();
  const notes: string[] = [];
  const used: string[] = [];
  for (const path of migrations) {
    const text = await read(path);
    if (text === undefined) continue;
    used.push(path);
    for (const m of text.matchAll(/^\s*--\s*(.+?)\s*$/gm)) if (m[1]) notes.push(`- ${m[1]} (${path})`);
    const sql = text.replace(/--.*$/gm, "");
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."`[\]]+)\s*\(/gi;
    for (let m = create.exec(sql); m; m = create.exec(sql)) {
      let depth = 1;
      let i = create.lastIndex;
      for (; i < sql.length && depth; i++) depth += sql[i] === "(" ? 1 : sql[i] === ")" ? -1 : 0;
      const cols = topLevelParts(sql.slice(create.lastIndex, i - 1))
        .map((p) => p.trim())
        .filter((p) => p && !CONSTRAINT.test(p))
        .map((p) => bareName(p.split(/\s+/)[0] ?? ""));
      tables.set(bareName(m[1] ?? ""), cols);
    }
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?([\w."`[\]]+)\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\w"`]+)/gi,
    )) {
      const t = bareName(m[1] ?? "");
      tables.set(t, uniq([...(tables.get(t) ?? []), bareName(m[2] ?? "")]));
    }
  }
  if (!tables.size) return undefined;
  const evidence = used.slice(0, 20);
  const names = [...tables.keys()];
  return {
    source: "schema",
    type: "schema",
    title: "Database schema",
    summary:
      `${names.length} table${names.length === 1 ? "" : "s"} from ${used.length} migration${used.length === 1 ? "" : "s"}: ${names.join(", ")}.`.slice(
        0,
        200,
      ),
    body: [
      "## Shape",
      "",
      ...[...tables].map(([t, cols]) => `- \`${t}\`: ${cols.join(", ")}`),
      "",
      "## Invariants",
      "",
      ...(notes.length ? notes : ["_Not stated in the migrations._"]),
      "",
      "## Migration notes",
      "",
      ...used.map((f) => `- ${f}`),
      "",
      "## Gotchas",
      "",
      "_Not stated in the migrations._",
    ].join("\n"),
    status: "active",
    tags: ["adopted"],
    evidence,
  };
}

const NOT_STATED = "_Not stated in the build files._";

/** 08 §2.1: CI workflows, Makefile and package scripts → a "Build and deploy" runbook skeleton. */
export async function ciCandidate(
  files: readonly string[],
  read: ReadText,
): Promise<AdoptCandidate | undefined> {
  const steps: string[] = [];
  const evidence: string[] = [];
  const ciRuns: string[] = [];
  for (const path of files
    .filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(f) || f === ".gitlab-ci.yml")
    .sort(sortPaths)) {
    const text = await read(path);
    if (text === undefined) continue;
    const runs = runSteps(text);
    if (path === ".gitlab-ci.yml")
      for (const block of text.matchAll(/^\s*script:\s*\n((?:\s+-\s+.*\n?)+)/gm))
        runs.push(...[...(block[1] ?? "").matchAll(/-\s+(.+?)\s*$/gm)].map((m) => m[1] ?? ""));
    if (!runs.length) continue;
    ciRuns.push(...runs);
    steps.push(`- CI \`${path}\`: ${runs.map((r) => `\`${r}\``).join(", ")}`);
    evidence.push(path);
  }
  if (files.includes("Makefile")) {
    const text = await read("Makefile");
    const targets = [...(text ?? "").matchAll(/^([A-Za-z0-9_][\w.-]*):(?!=)[^\n]*\n((?:\t.*\n?)*)/gm)];
    for (const t of targets) {
      const recipe = (t[2] ?? "")
        .split("\n")
        .map((l) => l.replace(/^\t@?/, "").trim())
        .filter(Boolean);
      steps.push(`- \`make ${t[1]}\`${recipe.length ? `: ${recipe.map((r) => `\`${r}\``).join("; ")}` : ""}`);
    }
    if (targets.length) evidence.push("Makefile");
  }
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse((await read("package.json")) ?? "{}") as Record<string, unknown>;
      const scripts =
        pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
      const pm =
        typeof pkg.packageManager === "string"
          ? (pkg.packageManager.split("@")[0] ?? "npm")
          : files.includes("pnpm-lock.yaml") || ciRuns.some((r) => r.startsWith("pnpm"))
            ? "pnpm"
            : files.includes("yarn.lock") || ciRuns.some((r) => r.startsWith("yarn"))
              ? "yarn"
              : "npm";
      const names = Object.keys(scripts).sort();
      for (const n of names) steps.push(`- \`${pm} run ${n}\`: \`${String(scripts[n])}\``);
      if (names.length) evidence.push("package.json");
    } catch {
      // not JSON: nothing to read
    }
  }
  if (!steps.length) return undefined;
  evidence.sort(sortPaths);
  return {
    source: "ci",
    type: "runbook",
    title: "Build and deploy",
    summary: `How the project is built, tested and deployed, from ${evidence.join(", ")}.`.slice(0, 200),
    body: [
      "## When to use",
      "",
      "Building, testing or deploying the project, as the CI and build files do it.",
      "",
      "## Steps",
      "",
      ...steps,
      "",
      "## Rollback",
      "",
      NOT_STATED,
      "",
      "## Verify",
      "",
      NOT_STATED,
    ].join("\n"),
    status: "active",
    tags: ["adopted"],
    evidence,
  };
}

/** `run:` commands of a GitHub workflow, including `run: |` and `run: >` block scalars. */
function runSteps(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*?)\s*$/.exec(lines[i] ?? "");
    if (!m) continue;
    const keyIndent = (m[1] ?? "").length + (m[2] ?? "").length;
    const value = m[3] ?? "";
    if (!/^[|>][-+]?$/.test(value)) {
      if (value) out.push(value.replace(/^["']|["']$/g, ""));
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (!l.trim()) continue;
      if (l.length - l.trimStart().length <= keyIndent) break;
      out.push(l.trim());
      i = j;
    }
  }
  return out;
}
