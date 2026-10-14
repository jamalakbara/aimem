#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  cryptoRandom,
  DEFAULT_LOCAL_MODEL,
  type EmbeddingStatus,
  execaGit,
  LOCAL_MODELS,
  type LocalModelName,
  loadEmbeddingProvider,
  nodeFs,
  type ResolvedProject,
  systemClock,
} from "@aimem/core";
import { serveStdio } from "@aimem/mcp";
import { run } from "./run.js";

const modelsDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");
const git = execaGit();

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
    }),
});
