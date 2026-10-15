import { join, resolve } from "node:path";
import {
  AimemError,
  addHandoff,
  applyWritePolicy,
  gitDiagnostics,
  type HandoffSections,
  loadIndex,
  loadProject,
  loadVectorCache,
  parseHandoffFile,
  resolveAuthorWithGit,
  resolveEmbeddingProvider,
  slugify,
  summarizeNotebook,
  validateNotebook,
} from "@aimem/core";
import { RECORD_TYPES, SPEC_VERSION, STATUSES } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

export interface HandoffOptions extends HandoffSections {
  task?: string;
  fromFile?: string;
  releaseClaims?: boolean;
  commit?: boolean;
  author?: string;
}

/** `aimem handoff` (04 §4). */
export async function handoff(deps: CliDeps, g: GlobalOptions, o: HandoffOptions): Promise<CommandResult> {
  const who = await resolveAuthorWithGit({
    ...(o.author ? { flag: o.author } : {}),
    env: deps.env,
    git: deps.git,
    cwd: g.dir,
  });
  const nb = await loadProject(deps.fs, g.dir);
  let file: HandoffSections = {};
  if (o.fromFile) {
    const text = await deps.fs.readFile(resolve(deps.cwd, o.fromFile)).catch(() => {
      throw new AimemError("USAGE", `cannot read --from-file ${o.fromFile}`);
    });
    file = parseHandoffFile(text);
  }
  const pick = (k: keyof HandoffSections) => o[k] ?? file[k];
  const { branch } = await gitDiagnostics(deps.git, nb.root);
  const r = await addHandoff(
    nb,
    {
      done: pick("done") ?? "",
      notDone: pick("notDone") ?? "",
      next: pick("next") ?? "",
      author: who,
      ...(pick("blocked") ? { blocked: pick("blocked") as string } : {}),
      ...(pick("notes") ? { notes: pick("notes") as string } : {}),
      ...(o.task ? { task: o.task } : {}),
      ...(branch ? { branch } : {}),
    },
    { fs: deps.fs, clock: deps.clock, random: deps.random },
  );
  const firstDone =
    (pick("done") ?? "")
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/^\s*[-*+]\s+/, "")
      .trim() ?? "";
  const git = await applyWritePolicy({
    git: deps.git,
    nb,
    author: who,
    files: r.changed,
    message: `aimem: handoff ${r.ref} ${firstDone}`.slice(0, 120),
    ...(o.commit ? { override: "commit" as const } : {}),
  });
  const warnings = [...r.warnings, ...git.warnings];
  if (o.releaseClaims) warnings.push("live claims arrive in M3; nothing to release");
  return {
    data: {
      ref: r.ref,
      file: r.file,
      changed: r.changed,
      ...(o.task ? { task: o.task } : {}),
      ...(branch ? { branch } : {}),
      git: git.action,
      claimsReleased: 0,
    },
    text: `Handoff ${r.ref} → ${r.file}\n`,
    warnings,
  };
}

/** `aimem status` (04 §3). */
export async function status(deps: CliDeps, g: GlobalOptions): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const s = summarizeNotebook(nb, await loadIndex(nb, { fs: deps.fs }), deps.clock.now());
  const lines = [`aimem — ${s.project} (${s.mode}, sync: ${s.sync}) · ${s.total} records`, "", "Counts:"];
  for (const t of RECORD_TYPES) {
    const c = s.counts[t];
    if (!c) continue;
    const order: readonly string[] = STATUSES[t];
    lines.push(
      `  ${t}: ${Object.keys(c)
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))
        .map((k) => `${k} ${c[k]}`)
        .join(", ")}`,
    );
  }
  lines.push(
    "",
    "Open p0/p1 tasks:",
    ...(s.urgentTasks.length
      ? s.urgentTasks.map((t) => `  ${t.ref} [${t.status}, ${t.priority}] ${t.title}`)
      : ["  none"]),
  );
  lines.push("", `Stale or expired: ${s.stale.length}${s.stale.length ? " (aimem list --stale)" : ""}`);
  lines.push(
    `Waiting for human review: ${s.unreviewed.agent} agent, ${s.unreviewed.inferred} inferred (aimem verify <ref>)`,
  );
  if (s.problems) lines.push(`Unreadable files: ${s.problems} (aimem validate)`);
  lines.push(
    s.lastHandoff
      ? `Last handoff: ${s.lastHandoff.ref} ${s.lastHandoff.created.slice(0, 10)} (${s.lastHandoff.author}) — ${s.lastHandoff.summary}`
      : "Last handoff: none",
  );
  lines.push(`Live claims: ${s.claims}`);
  return { data: s, text: `${lines.join("\n")}\n` };
}

type Check = { name: string; status: "ok" | "warn" | "info"; detail: string };

const ADAPTER_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  ".cursor/rules/aimem.mdc",
];

/** `aimem doctor` (04 §6). Read-only, no network; always exits 0. */
export async function doctor(deps: CliDeps, g: GlobalOptions): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const d = await gitDiagnostics(deps.git, nb.root);
  const checks: Check[] = [];
  checks.push(
    d.installed
      ? { name: "git", status: "ok", detail: `git ${d.version}` }
      : {
          name: "git",
          status: "warn",
          detail: "git not found; records can be read and written but not staged or committed",
        },
  );
  checks.push(
    d.repo
      ? {
          name: "repository",
          status: "ok",
          detail: d.branch
            ? `inside a git repository on branch ${d.branch}`
            : "inside a git repository (detached HEAD)",
        }
      : {
          name: "repository",
          status: "warn",
          detail: "not inside a git repository; records are not versioned",
        },
  );
  const envAuthor = deps.env.AIMEM_AUTHOR;
  checks.push(
    envAuthor
      ? { name: "author", status: "ok", detail: `AIMEM_AUTHOR=${envAuthor}` }
      : d.userName
        ? { name: "author", status: "ok", detail: `git user.name → human:${slugify(d.userName)}` }
        : { name: "author", status: "warn", detail: "no author: set AIMEM_AUTHOR or git config user.name" },
  );
  checks.push({
    name: "remote",
    status: "info",
    detail: d.remotes.length ? `remotes: ${d.remotes.join(", ")}` : "no git remote (fine for solo use)",
  });
  checks.push({
    name: "spec",
    status: "ok",
    detail: `project.yaml spec v${nb.config.aimem} (this tool supports v${SPEC_VERSION})`,
  });
  const issues = await validateNotebook(nb, { fs: deps.fs, clock: deps.clock });
  const errors = issues.filter((i) => i.level === "error").length;
  checks.push(
    issues.length
      ? {
          name: "notebook",
          status: "warn",
          detail: `${errors} errors, ${issues.length - errors} warnings (aimem validate)`,
        }
      : { name: "notebook", status: "ok", detail: "no validation issues" },
  );
  const withBlock: string[] = [];
  for (const f of ADAPTER_FILES) {
    const text = await deps.fs.readFile(join(nb.root, f)).catch(() => "");
    if (text.includes("<!-- aimem:begin")) withBlock.push(f);
  }
  checks.push(
    withBlock.length
      ? { name: "adapters", status: "ok", detail: `aimem block in ${withBlock.join(", ")}` }
      : {
          name: "adapters",
          status: "warn",
          detail:
            "no aimem block in AGENTS.md or CLAUDE.md yet; agents will not follow the protocol (aimem adapters sync arrives in slice 2.5)",
        },
  );
  const embStatus = resolveEmbeddingProvider(nb.config, deps.embedder);
  const vc = await loadVectorCache(deps.fs, nb);
  const cached = vc.cache
    ? `${vc.cache.meta.chunks.length} chunks cached from ${vc.cache.meta.provider}`
    : vc.problem;
  if (!embStatus.available) {
    checks.push({
      name: "search",
      status: "info",
      detail: `keyword search (BM25); semantic search off: ${embStatus.reason}${vc.cache ? ` (${cached})` : ""}`,
    });
  } else if (
    vc.cache &&
    vc.cache.meta.provider === embStatus.provider.id &&
    vc.cache.meta.dimensions === embStatus.provider.dimensions
  ) {
    checks.push({
      name: "search",
      status: "ok",
      detail: `semantic search ready: ${embStatus.provider.id}, ${vc.cache.meta.chunks.length} chunks cached`,
    });
  } else {
    checks.push({
      name: "search",
      status: "warn",
      detail: `semantic search available (${embStatus.provider.id}) but the vector cache needs building (${cached}); run aimem index --embeddings`,
    });
  }
  const configured: string[] = [];
  if (nb.config.sync === "server") configured.push(`sync server ${nb.config.server?.url ?? "(no url)"}`);
  const emb = nb.config.retrieval?.embeddings;
  if (emb?.provider === "openai-compatible")
    configured.push(
      `remote embeddings ${emb.endpoint ?? "(no endpoint)"}${emb.allow_remote ? "" : " (blocked: allow_remote is false)"}`,
    );
  if (nb.config.retrieval?.llm?.provider && nb.config.retrieval.llm.provider !== "none")
    configured.push(`LLM ${nb.config.retrieval.llm.endpoint ?? "(no endpoint)"}`);
  checks.push({
    name: "outbound data",
    status: "info",
    detail: `nothing leaves this machine: aimem does not push, contact a server or send text to remote models${configured.length ? `; configured but not implemented yet: ${configured.join("; ")}` : ""}`,
  });
  return {
    data: { checks },
    text: `${checks.map((c) => `[${c.status}] ${c.name} — ${c.detail}`).join("\n")}\n`,
  };
}
