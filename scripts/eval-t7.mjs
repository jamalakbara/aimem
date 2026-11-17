// Cached-model-only diagnostic runner. Does not modify fixtures or download models.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildQuery, buildVectorCache, createLocalProvider, loadIndex, loadProject,
  nodeFs, runEvalSet, scoreCandidates, semanticForQuery, loadVectorCache,
} from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

const work = mkdtempSync(join(tmpdir(), "aimem-t7-"));
try {
  cpSync(new URL("../fixtures/projects/medium", import.meta.url), work, { recursive: true });
  const nb = await loadProject(nodeFs, work);
  const index = await loadIndex(nb, { fs: nodeFs });
  let provider = await createLocalProvider({
    model: "auto", allowDownload: false,
    cacheDir: join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models"),
  });
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) } });
  const center = Number(process.argv[2] ?? 0);
  if (center) {
    const { cache } = await loadVectorCache(nodeFs, nb);
    const mean = new Float32Array(provider.dimensions);
    for (let i = 0; i < cache.vectors.length; i++) mean[i % mean.length] += cache.vectors[i] / cache.meta.chunks.length;
    const base = provider;
    provider = { ...base, id: `${base.id}:center-${center}`, embed: async (texts, kind) =>
      (await base.embed(texts, kind)).map(v => v.map((x, i) => x - center * mean[i])) };
    await buildVectorCache(nb, index, provider, { fs: nodeFs, random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) } });
  }
  for (const name of ["medium", "t7-heldout"]) {
    const set = YAML.parse(readFileSync(new URL(`../fixtures/evals/${name}.yaml`, import.meta.url), "utf8"));
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
