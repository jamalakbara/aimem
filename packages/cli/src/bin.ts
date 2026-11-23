#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  createLocalRanker,
  cryptoRandom,
  DEFAULT_LOCAL_MODEL,
  type EmbeddingStatus,
  execaGh,
  execaGit,
  execaRunner,
  LOCAL_MODELS,
  type LocalModelName,
  loadEmbeddingProvider,
  loadLlmProvider,
  nodeFs,
  type ResolvedProject,
  spawnDetached,
  systemClock,
} from "@aimem/core";
import { serveStdio } from "@aimem/mcp";
import { run } from "./run.js";

const modelsDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");
const liveTimeout = Number(process.env.AIMEM_LIVE_TIMEOUT_MS);
const git = execaGit(
  {},
  Number.isFinite(liveTimeout) && liveTimeout > 0 ? { networkTimeoutMs: liveTimeout } : {},
);
const loadRanker = async (allowDownload: boolean) => {
  try {
    if (allowDownload)
      process.stderr.write(
        `Preparing optional local BGE cross-encoder in ${modelsDir} (~571 MB one-time model download) …\n`,
      );
    return {
      available: true as const,
      provider: await createLocalRanker({ cacheDir: modelsDir, allowDownload }),
    };
  } catch {
    return {
      available: false as const,
      reason: "local cross-encoder unavailable; run aimem index --reranker",
    };
  }
};

async function loadEmbedder(config: ResolvedProject, allowDownload: boolean): Promise<EmbeddingStatus> {
  const emb = config.retrieval?.embeddings;
  if (allowDownload && (emb?.provider ?? "local") === "local") {
    const name = (emb?.model && emb.model !== "auto" ? emb.model : DEFAULT_LOCAL_MODEL) as LocalModelName;
    const spec = LOCAL_MODELS[name];
    if (spec && !existsSync(join(modelsDir, spec.hub, "onnx", "model_quantized.onnx"))) {
      process.stderr.write(
        `Downloading local embedding model ${name} (~${spec.downloadMB} MB, one time) to ${modelsDir} …\n`,
      );
    }
  }
  return loadEmbeddingProvider(config, { cacheDir: modelsDir, allowDownload, env: process.env });
}

process.exitCode = await run(process.argv.slice(2), {
  fs: nodeFs,
  clock: systemClock,
  random: cryptoRandom,
  env: process.env,
  cwd: process.cwd(),
  cliEntry: fileURLToPath(import.meta.url),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdin: async () => {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data;
  },
  // `aimem review` walks its queue only on a real terminal; pipes and agents get the list.
  ...(process.stdin.isTTY && process.stdout.isTTY
    ? {
        prompt: async (question: string) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await new Promise<string | undefined>((done) => {
              rl.once("close", () => done(undefined));
              rl.question(question, done);
            });
          } finally {
            rl.close();
          }
        },
        edit: async (file: string) => {
          // `$EDITOR` may carry arguments ("code --wait"); the file is its own argument, never passed
          // through a shell.
          const fallback = process.platform === "win32" ? "notepad" : "vi";
          if (!process.env.VISUAL && !process.env.EDITOR)
            process.stderr.write(`aimem: $VISUAL and $EDITOR are not set; opening ${fallback}\n`);
          const setting = process.env.VISUAL || process.env.EDITOR || fallback;
          const [cmd = "vi", ...args] = (setting.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) =>
            t.replace(/^["']|["']$/g, ""),
          );
          const r = spawnSync(cmd, [...args, file], { stdio: "inherit" });
          if (r.error) throw new Error(`could not start ${cmd}: ${r.error.message}`);
          if (r.status !== 0) throw new Error(`editor ${cmd} exited with ${r.status ?? r.signal}`);
        },
      }
    : {}),
  git,
  gh: execaGh(),
  fetch: (url, init) => fetch(url, init),
  loadEmbedder,
  loadRanker,
  spawnBackground: (args, cwd) =>
    spawnDetached(process.execPath, [fileURLToPath(import.meta.url), ...args], cwd),
  loadLlm: (config) => loadLlmProvider(config, { runner: execaRunner(), env: process.env }),
  // stdout carries the MCP protocol: nothing else may be printed while serving.
  serveMcp: () =>
    serveStdio({
      fs: nodeFs,
      clock: systemClock,
      random: cryptoRandom,
      git,
      env: process.env,
      cwd: process.cwd(),
      loadEmbedder,
      loadRanker,
      loadLlm: (config) => loadLlmProvider(config, { runner: execaRunner(), env: process.env }),
    }),
});
