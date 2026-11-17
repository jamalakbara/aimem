// Experimental Qwen3 comparison; explicit --download permits ~614 MB model download. No default change.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildQuery, buildVectorCache, loadIndex, loadProject,
  nodeFs, runEvalSet, scoreCandidates, semanticForQuery,
} from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

const work = mkdtempSync(join(tmpdir(), "aimem-t7-"));
try {
  cpSync(new URL("../fixtures/projects/medium", import.meta.url), work, { recursive: true });
  const nb = await loadProject(nodeFs, work);
  const index = await loadIndex(nb, { fs: nodeFs });
  const { pipeline } = await import("../packages/core/node_modules/@huggingface/transformers/dist/transformers.node.mjs");
  const pipe = await pipeline("feature-extraction", "onnx-community/Qwen3-Embedding-0.6B-ONNX", {
    dtype: "q8", local_files_only: !process.argv.includes("--download"),
    cache_dir: join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models"),
  });
  const provider = { id: "experimental:qwen3-0.6b", dimensions: 1024, maxInputTokens: 512,
    embed: async (texts, kind) => {
      const out = [];
      for (let i = 0; i < texts.length; i += 4) {
        const batch = texts.slice(i, i + 4).map(t => kind === "query" ? `Instruct: ${process.env.AIMEM_EVAL_INSTRUCTION || "Given a web search query, retrieve relevant passages that answer the query"}\nQuery:${t}` : t);
        out.push(...(await pipe(batch, { pooling: "last_token", normalize: true, max_length: 512 })).tolist());
      }
      return out;
    },
  };
  process.stderr.write("Building experimental Qwen document vectors locally...\n");
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) } });
  for (const name of ["medium", "t7-heldout", "t7-query-heldout"]) {
    const set = YAML.parse(readFileSync(new URL(`../fixtures/evals/${name}.yaml`, import.meta.url), "utf8"));
    process.stderr.write(`Evaluating ${name}...\n`);
    const lexical = await runEvalSet(nb, index, set);
    const hybrid = await runEvalSet(nb, index, set, { provider, fs: nodeFs });
    console.log(JSON.stringify({ name, lexical: lexical.byCategory, hybrid: hybrid.byCategory, overall: hybrid.overall }));
    for (const c of hybrid.cases.filter(c => c.missing.length)) {
      const original = set.cases.find(x => x.id === c.id);
      const semantic = await semanticForQuery(nb, index, provider, buildQuery(nb, index, original), { fs: nodeFs });
      const { candidates } = scoreCandidates(nb, index, { ...original, semantic }, new Date(set.clock));
      console.log(JSON.stringify({ case: c.id, missing: c.missing, top: candidates.slice(0, 12).map(x => ({ ref: x.record.id, title: x.record.title, ...x.parts })), expected: c.missing.map(ref => ({ rank: candidates.findIndex(x => x.record.id === ref) + 1, ...candidates.find(x => x.record.id === ref)?.parts })) }));
    }
  }
} finally { rmSync(work, { recursive: true, force: true }); }
