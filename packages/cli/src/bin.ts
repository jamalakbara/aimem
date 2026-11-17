#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createLocalRanker,
  cryptoRandom,
  DEFAULT_LOCAL_MODEL,
  type EmbeddingStatus,
  execaGit,
  execaRunner,
  LOCAL_MODELS,
  type LocalModelName,
  loadEmbeddingProvider,
  loadLlmProvider,
  nodeFs,
  type ResolvedProject,
  systemClock,
} from "@aimem/core";
import { serveStdio } from "@aimem/mcp";
import { run } from "./run.js";

const modelsDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");
const git = execaGit();
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
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdin: async () => {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data;
  },
  git,
  loadEmbedder,
  loadRanker,
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
