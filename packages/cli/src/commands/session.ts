import { resolve } from "node:path";
import { adapterStatus } from "@aimem/adapters";
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
  readLiveState,
  releaseSessionClaims,
  resolveAuthorWithGit,
  semanticForQuery,
  slugify,
  summarizeNotebook,
  validateNotebook,
} from "@aimem/core";
import { RECORD_TYPES, SPEC_VERSION, STATUSES } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { developmentBuildCheck } from "./development-build.js";
import { embeddingStatus, writeDeps } from "./embedder.js";

export interface HandoffOptions extends HandoffSections {
  task?: string;
  fromFile?: string;
  releaseClaims?: boolean;
  session?: string;
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
    await writeDeps(deps, nb),
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
  // 3.5 decision 4: the record is written first; releasing claims never undoes it.
  const session = o.session ?? deps.env.AIMEM_SESSION;
  const taskRecord = o.task
    ? (await loadIndex(nb, { fs: deps.fs })).records.find(
        (rec) => rec.type === "task" && (rec.id === o.task || o.task?.endsWith(`:${rec.id}`)),
      )
    : undefined;
  const released = await releaseSessionClaims(nb, { holder: who, ...(session ? { session } : {}) }, deps, {
    release: o.releaseClaims !== false,
    ...(taskRecord ? { task: { ref: taskRecord.id, paths: taskRecord.paths } } : {}),
  });
  warnings.push(...released.warnings);
  const c = released.claims;
  const lines = [`Handoff ${r.ref} → ${r.file}`];
  if (c.status !== "off") {
    lines.push(
      c.released.length
        ? `Released claims: ${c.released.join(", ")}`
        : c.status === "unavailable"
          ? "Claims: not checked (team claims unavailable)"
          : "Released claims: none",
    );
    for (const k of c.kept) lines.push(`Still held: ${k.ref} (${k.reason})`);
    for (const rel of c.related)
      lines.push(
        `Also claimed: ${rel.ref} by ${rel.holders.join(", ")}${rel.paths ? ` on ${rel.paths.join(", ")}` : ""}`,
      );
    lines.push(`Claims checked at ${c.checkedAt}; run aimem live before picking this up.`);
  }
  return {
    data: {
      ref: r.ref,
      file: r.file,
      changed: r.changed,
      ...(o.task ? { task: o.task } : {}),
      ...(branch ? { branch } : {}),
      git: git.action,
      claimsReleased: c.released.length,
      ...(c.status === "off" ? {} : { claims: c }),
    },
    text: `${lines.join("\n")}\n`,
    warnings,
  };
}

/** `aimem status` (04 §3). */
/** The caller's author for marking "yours", or undefined when none is configured. */
export async function currentAuthor(deps: CliDeps, root: string): Promise<string | undefined> {
  return resolveAuthorWithGit({ env: deps.env, git: deps.git, cwd: root }).catch(() => undefined);
}

export async function status(
  deps: CliDeps,
  g: GlobalOptions,
  o: { live?: boolean } = {},
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const state = await readLiveState(nb, deps, { skip: o.live === false });
  const holder = state.status === "off" ? undefined : await currentAuthor(deps, nb.root);
  const s = summarizeNotebook(nb, await loadIndex(nb, { fs: deps.fs }), deps.clock.now(), {
    state,
    ...(holder ? { holder } : {}),
  });
  const warnings =
    state.status === "unavailable"
      ? [`Team claims could not be checked (${state.reason}). Run aimem live once the connection is back.`]
      : [];
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
  const c = s.claims;
  const yours = c ? c.mine.filter((m) => !m.expired && !m.unsynced).length : 0;
  lines.push(
    !c
      ? "Live claims: off (no team Git sync)"
      : c.status === "on"
        ? `Live claims: ${c.active} active (${yours} yours) · ${c.expired} expired · ${c.unsynced} unsynced (aimem live for details)`
        : c.status === "skipped"
          ? `Live claims: not checked (--no-live) · ${c.unsynced} unsynced`
          : `Live claims: unavailable, team claims could not be checked · ${c.unsynced} unsynced`,
  );
  return { data: s, text: `${lines.join("\n")}\n`, warnings };
}

type Check = { name: string; status: "ok" | "warn" | "info"; detail: string };

/** `aimem doctor` (04 §6). Read-only, no network; always exits 0. */
export async function doctor(deps: CliDeps, g: GlobalOptions): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const d = await gitDiagnostics(deps.git, nb.root);
  const checks: Check[] = [];
  const build = await developmentBuildCheck(deps.fs, deps.cliEntry);
  if (build) checks.push(build);
  if (nb.config.retrieval?.rerank === "cross-encoder") {
    try {
      const status = await deps.loadRanker?.(false);
      checks.push(
        status?.available
          ? {
              name: "local reranker",
              status: "ok",
              detail: `${status.provider.id}: local inference; no record text leaves this machine`,
            }
          : {
              name: "local reranker",
              status: "warn",
              detail: status?.reason ?? "local model unavailable; run aimem index --reranker",
            },
      );
    } catch {
      checks.push({
        name: "local reranker",
        status: "warn",
        detail: "local model unavailable; run aimem index --reranker",
      });
    }
  }
  checks.push({
    name: "call log",
    status: "info",
    detail:
      ".aimem/.cache/calls.jsonl: local call metadata only (time, provider/model, latency, status, counts and available token usage); no record text, prompts, answers or error messages",
  });
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
  const adapterStates = await adapterStatus(nb, deps.fs);
  const good = adapterStates.filter((a) => a.state === "current" || a.state === "via AGENTS.md");
  const bad = adapterStates.filter((a) => !good.includes(a));
  checks.push(
    adapterStates.length && !bad.length
      ? {
          name: "adapters",
          status: "ok",
          detail: `aimem block current in ${good.map((a) => a.file).join(", ")}`,
        }
      : {
          name: "adapters",
          status: "warn",
          detail: adapterStates.length
            ? `${bad.map((a) => `${a.file} ${a.state}`).join(", ")}; run aimem adapters sync so agents follow the protocol`
            : "no adapter targets configured; run aimem adapters sync so agents follow the protocol",
        },
  );
  const embStatus = await embeddingStatus(deps, nb, false);
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
    const sem = await semanticForQuery(nb, await loadIndex(nb, { fs: deps.fs }), embStatus.provider, "", {
      fs: deps.fs,
    });
    const pct = "coverage" in sem ? Math.floor(sem.coverage * 100) : 0;
    checks.push({
      name: "search",
      status: pct === 100 ? "ok" : "warn",
      detail: `semantic search ready: ${embStatus.provider.id}, ${vc.cache.meta.chunks.length} chunks cached, coverage ${pct}%${pct === 100 ? "" : "; run aimem index --embeddings"}`,
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
  // 15 §12: say exactly what leaves the machine. Remote embeddings are live since slice 2.4b.
  const remoteEmbeddings = emb?.provider === "openai-compatible" && emb.allow_remote === true;
  if (emb?.provider === "openai-compatible" && !remoteEmbeddings)
    configured.push(`remote embeddings ${emb.endpoint ?? "(no endpoint)"} (blocked: allow_remote is false)`);
  const llm = nb.config.retrieval?.llm;
  if (llm?.provider === "claude-cli")
    configured.push(
      llm.allow_remote === true
        ? "LLM claude-cli: record text would go to Anthropic through your Claude Code login (claude -p, no tools) when aimem ask arrives"
        : "LLM claude-cli (blocked: allow_remote is false)",
    );
  else if (llm?.provider && llm.provider !== "none")
    configured.push(`LLM ${llm.endpoint ?? "(no endpoint)"}`);
  const host = (() => {
    try {
      return new URL(emb?.endpoint ?? "").host;
    } catch {
      return emb?.endpoint ?? "(no endpoint)";
    }
  })();
  checks.push(
    remoteEmbeddings
      ? {
          name: "outbound data",
          status: "warn",
          detail: `record text is sent to ${host} to compute embeddings (retrieval.embeddings.allow_remote: true); no-embed and secret-flagged records are never sent${configured.length ? `; configured but not implemented yet: ${configured.join("; ")}` : ""}`,
        }
      : {
          name: "outbound data",
          status: "info",
          detail: `nothing leaves this machine: aimem does not push, contact a server or send text to remote models${configured.length ? `; configured but not implemented yet: ${configured.join("; ")}` : ""}`,
        },
  );
  return {
    data: { checks },
    text: `${checks.map((c) => `[${c.status}] ${c.name} — ${c.detail}`).join("\n")}\n`,
  };
}
