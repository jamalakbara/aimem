#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  cryptoRandom,
  DEFAULT_LOCAL_MODEL,
  execaGit,
  LOCAL_MODELS,
  type LocalModelName,
  loadEmbeddingProvider,
  nodeFs,
  systemClock,
} from "@aimem/core";
import { run } from "./run.js";

const modelsDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");

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
  git: execaGit(),
  loadEmbedder: async (config, allowDownload) => {
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
  },
});
