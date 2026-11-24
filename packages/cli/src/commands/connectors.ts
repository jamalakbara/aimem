import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  AimemError,
  applyWritePolicy,
  collectGoogle,
  GoogleClient,
  googleId,
  loadIndex,
  loadProject,
  markSourcesMissing,
  type Notebook,
  parseGoogleKey,
  resolveAuthorWithGit,
  setProjectValue,
  upsertExternalMany,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { writeDeps } from "./embedder.js";
import { VISIBILITY_WARNING, withImportLock } from "./import.js";

export interface SourcesOptions {
  folder?: string;
  file?: string;
  author?: string;
  dryRun?: boolean;
  strict?: boolean;
  force?: boolean;
  offline?: boolean;
}

const googleConfig = (nb: Notebook) => {
  const g = nb.config.connectors?.google;
  return {
    folder: g?.inbox_folder_id ? googleId(g.inbox_folder_id) : undefined,
    files: (g?.files ?? []).map(googleId).filter((x): x is string => x !== undefined),
  };
};

/** `aimem sources list | status | add google | remove google | sync` (04, 16 §5, 23 §4b.4). */
export async function sources(
  deps: CliDeps,
  g: GlobalOptions,
  args: string[],
  o: SourcesOptions,
): Promise<CommandResult> {
  const [sub = "list", kind] = args;
  const nb = await loadProject(deps.fs, g.dir);
  if (sub === "list") return list(deps, nb);
  if (sub === "status") return status(deps, nb);
  if (sub === "sync") return sync(deps, g, nb, o);
  if (sub !== "add" && sub !== "remove")
    throw new AimemError("USAGE", "use aimem sources list, status, add google, remove google or sync");
  if (kind !== "google") throw new AimemError("USAGE", `unknown source '${kind ?? ""}' (expected: google)`);
  const author = await who(deps, g, o);
  // Which documents are shared with the project is a person's choice (16 §5, §12), not an agent's.
  if (!author.startsWith("human:"))
    throw new AimemError(
      "PERMISSION_DENIED",
      `only a human can ${sub} sources; ask a person on the team to run aimem sources ${sub} google`,
    );
  if (sub === "remove") {
    await setProjectValue(deps.fs, nb, ["connectors", "google"], {}, deps.random);
    return {
      data: { removed: "google" },
      text: "Google is no longer synced. Its records stay; aimem detach makes one editable here.\n",
    };
  }
  if (!o.folder === !o.file)
    throw new AimemError("USAGE", "pass either --folder <id or link> or --file <id or link>");
  const id = googleId(o.folder ?? o.file ?? "");
  if (!id) throw new AimemError("USAGE", "that is not a Google Drive id or link");
  const cfg = googleConfig(nb);
  if (o.folder)
    await setProjectValue(deps.fs, nb, ["connectors", "google", "inbox_folder_id"], id, deps.random);
  else if (!cfg.files.includes(id))
    await setProjectValue(deps.fs, nb, ["connectors", "google", "files"], [...cfg.files, id], deps.random);
  return {
    data: { added: "google", ...(o.folder ? { folder: id } : { file: id }) },
    text: `Added the Google ${o.folder ? "inbox folder" : "file"} ${id}. Share it (read-only) with your service account, then run aimem sources sync.\n`,
    warnings: [VISIBILITY_WARNING],
  };
}

const who = (deps: CliDeps, g: GlobalOptions, o: { author?: string }) =>
  resolveAuthorWithGit({ ...(o.author ? { flag: o.author } : {}), env: deps.env, git: deps.git, cwd: g.dir });

async function list(deps: CliDeps, nb: Notebook): Promise<CommandResult> {
  const cfg = googleConfig(nb);
  const index = await loadIndex(nb, { fs: deps.fs });
  const records = index.records.filter((r) => {
    const s = r.fm.source as { system?: string } | undefined;
    return r.fm.managed_by === "external" && s?.system?.startsWith("google-");
  }).length;
  const found =
    cfg.folder || cfg.files.length
      ? [{ kind: "google", folder: cfg.folder ?? null, files: cfg.files, records }]
      : [];
  return {
    data: { sources: found },
    text: found.length
      ? `google  folder ${cfg.folder ?? "none"}, ${cfg.files.length} single file(s), ${records} record(s)\n`
      : "No sources. Add one with aimem sources add google --folder <id>.\n",
  };
}

/** What is synced and what is wrong with it, from the notebook and the key file alone: no network, no writes. */
async function status(deps: CliDeps, nb: Notebook): Promise<CommandResult> {
  const cfg = googleConfig(nb);
  const raw = nb.config.connectors?.google;
  const warnings: string[] = [];
  if (raw?.inbox_folder_id && !cfg.folder)
    warnings.push("connectors.google.inbox_folder_id in project.yaml is not a Google Drive id or link");
  if ((raw?.files ?? []).length > cfg.files.length)
    warnings.push(
      "connectors.google.files in project.yaml has entries that are not Google Drive ids or links",
    );
  const configured = Boolean(cfg.folder || cfg.files.length);
  const index = await loadIndex(nb, { fs: deps.fs });
  const mine = index.records.flatMap((r) => {
    const s = r.fm.source as { system?: string; state?: string; synced_at?: unknown } | undefined;
    return r.fm.managed_by === "external" && s?.system?.startsWith("google-") ? [{ r, s }] : [];
  });
  if (!configured && !mine.length)
    return {
      data: { sources: [] },
      text: "No sources. Add one with aimem sources add google --folder <id>.\n",
      warnings,
    };
  let credentials: "ready" | "missing" | "unusable" = "missing";
  if (deps.env.AIMEM_GOOGLE_CREDENTIALS || deps.env.GOOGLE_APPLICATION_CREDENTIALS)
    try {
      await googleKey(deps, nb);
      credentials = "ready";
    } catch (e) {
      credentials = "unusable";
      warnings.push(e instanceof AimemError ? e.message : "the Google key file cannot be used");
    }
  const missing = mine
    .filter(({ s }) => s.state === "missing")
    .map(({ r }) => ({ ref: r.id, title: r.title }))
    .sort((a, b) => (a.ref < b.ref ? -1 : 1));
  const documents = mine.filter(({ s }) => s.system === "google-doc").length;
  const times = mine
    .map(({ s }) => (s.synced_at instanceof Date ? s.synced_at.getTime() : Date.parse(String(s.synced_at))))
    .filter((t) => !Number.isNaN(t));
  const last_change = times.length ? new Date(Math.max(...times)).toISOString() : null;
  const rows = mine.length - documents;
  return {
    data: {
      sources: [
        {
          kind: "google",
          configured,
          folder: cfg.folder ?? null,
          files: cfg.files,
          credentials,
          documents,
          rows,
          missing,
          last_change,
        },
      ],
    },
    text: [
      configured
        ? `google  folder ${cfg.folder ?? "none"}, ${cfg.files.length} single file(s)`
        : "google  not configured; its records are no longer updated",
      `  key      ${{ ready: "ready (not tried against Google)", missing: "not set", unusable: "cannot be used" }[credentials]}`,
      `  records  ${documents} from Docs, ${rows} from Sheet rows, ${missing.length} missing at the source`,
      `  last change from a sync: ${last_change ?? "none"}`,
      ...missing.slice(0, 20).map((m) => `  missing  ${m.ref}  ${m.title}`),
      ...(missing.length > 20 ? [`  … ${missing.length - 20} more (--json lists all)`] : []),
      "",
    ].join("\n"),
    warnings,
  };
}

/** The key file, refused inside the repository so that it can never be committed (23 decision 4). */
async function googleKey(deps: CliDeps, nb: Notebook) {
  const path = deps.env.AIMEM_GOOGLE_CREDENTIALS || deps.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path)
    throw new AimemError(
      "SOURCE_AUTH",
      "set GOOGLE_APPLICATION_CREDENTIALS (or AIMEM_GOOGLE_CREDENTIALS) to the path of a service-account key file outside the repository",
    );
  const given = resolve(deps.cwd, path);
  const real = async (p: string) => (await deps.fs.realpath?.(p).catch(() => undefined)) ?? p;
  const top = await deps.git.run(["rev-parse", "--show-toplevel"], nb.root).catch(() => undefined);
  const gitRoot = top?.code === 0 && isAbsolute(top.stdout.trim()) ? top.stdout.trim() : undefined;
  const keys = [await real(given), resolve(await real(dirname(given)), given.split(/[\\/]/).at(-1) ?? "")];
  for (const root of [nb.root, ...(gitRoot ? [gitRoot] : [])]) {
    const r = await real(root);
    for (const k of keys) {
      const rel = relative(r, k);
      if (!rel.startsWith("..") && !isAbsolute(rel))
        throw new AimemError(
          "SOURCE_AUTH",
          "the Google key file is inside the repository; move it outside, so it can never be committed",
        );
    }
  }
  // A key file is a few KB: check before reading, so a device or a huge file cannot fill the memory.
  const info = await deps.fs.stat?.(given).catch(() => undefined);
  if (info && (info.isFile === false || (info.size ?? 0) > 64 * 1024))
    throw new AimemError("SOURCE_AUTH", "the Google key file is not a small regular file");
  const text = await deps.fs.readFile(given).catch(() => {
    throw new AimemError("SOURCE_AUTH", "the Google key file cannot be read");
  });
  return parseGoogleKey(text);
}

async function sync(
  deps: CliDeps,
  g: GlobalOptions,
  nb: Notebook,
  o: SourcesOptions,
): Promise<CommandResult> {
  const cfg = googleConfig(nb);
  if (!cfg.folder && !cfg.files.length)
    throw new AimemError(
      "USAGE",
      "no source is configured; add one with aimem sources add google --folder <id>",
    );
  if (o.offline)
    throw new AimemError("SOURCE_UNREACHABLE", "sources sync needs the network; run it without --offline");
  if (!deps.fetch) throw new AimemError("SOURCE_UNREACHABLE", "no network access here");
  const author = await who(deps, g, o);
  const client = new GoogleClient({
    key: await googleKey(deps, nb),
    fetch: deps.fetch,
    clock: deps.clock,
    sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
  });
  const index = await loadIndex(nb, { fs: deps.fs });
  // Everything is read before anything is written: an auth or network failure changes nothing.
  const got = await collectGoogle(
    client,
    { ...(cfg.folder ? { folder: cfg.folder } : {}), files: cfg.files },
    index.records,
    author,
  );
  if (o.dryRun)
    return {
      data: {
        dryRun: true,
        records: got.inputs.length,
        unchanged: got.unchanged.length,
        missing: got.missing.length,
        errors: got.errors,
      },
      text: `Dry run: ${got.inputs.length} records would be imported or updated, ${got.unchanged.length} unchanged, ${got.missing.length} missing, ${got.errors.length} errors. Nothing was written.\n`,
      warnings: got.warnings,
    };

  const wdeps = await writeDeps(deps, nb);
  const counts = { created: 0, updated: 0, unchanged: got.unchanged.length };
  const errors = [...got.errors];
  const warnings = [...got.warnings];
  const records: { ref: string; action: string; file: string }[] = [];
  const { changed, missing } = await withImportLock(deps, nb.dir, async () => {
    const done = got.inputs.length
      ? await upsertExternalMany(
          nb,
          got.inputs.map((i) => ({ ...i.input, ...(o.force ? { force: true } : {}) })),
          wdeps,
        )
      : { results: [], changed: [], warnings: [] };
    done.results.forEach((r, n) => {
      const item = got.inputs[n];
      const file = item?.file ?? "";
      if ("error" in r) {
        errors.push({
          file,
          reason: `${item?.where ? `${item.where}: ` : ""}${r.error.code}: ${r.error.message}`,
        });
        return;
      }
      counts[r.action]++;
      records.push({ ref: r.ref, action: r.action, file });
      warnings.push(...r.warnings);
    });
    const gone = await markSourcesMissing(nb, got.missing, wdeps);
    warnings.push(...done.warnings, ...gone.warnings);
    return { changed: [...new Set([...done.changed, ...gone.changed])].sort(), missing: got.missing.length };
  });
  const policy = changed.length
    ? await applyWritePolicy({
        git: deps.git,
        nb,
        author,
        files: changed,
        message: `aimem: sync Google (${counts.created} new, ${counts.updated} updated, ${missing} missing)`,
      })
    : { action: "none" as const, warnings: [] };
  return {
    data: { ...counts, missing, errors, records, git: policy.action },
    text: `Google: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ${missing} missing${errors.length ? `, ${errors.length} with errors` : ""}.\n`,
    warnings: [
      ...errors.map((e) => `${e.file}: ${e.reason}`),
      ...warnings,
      ...policy.warnings,
      VISIBILITY_WARNING,
    ],
    ...(o.strict && errors.length ? { exitCode: 1 } : {}),
  };
}
