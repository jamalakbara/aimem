// Model comparison for OQ-16 (docs/15 §4.2): runs the medium eval set lexical-only and hybrid with each
// candidate local model, prints a table and writes fixtures/evals/results/model-comparison.json.
// Downloads each model once into ~/.cache/aimem/models (or $AIMEM_HOME/models). Usage: pnpm compare-models
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildVectorCache, createLocalProvider, LOCAL_MODELS, loadIndex, loadProject, nodeFs, runEvalSet } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

const root = new URL("..", import.meta.url).pathname;
const cacheDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");
const set = YAML.parse(readFileSync(join(root, "fixtures/evals/medium.yaml"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "aimem-compare-"));
cpSync(join(root, "fixtures/projects", set.project), work, { recursive: true });
const nb = await loadProject(nodeFs, work);
const index = await loadIndex(nb, { fs: nodeFs });
const random = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const summarize = (r) => ({
  ...Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, v.recall])),
  overall: r.overall.recall,
  violations: r.overall.violations,
  budgetOk: r.overall.budgetOk,
});

const rows = [{ model: "lexical-only", downloadMB: 0, ...summarize(await runEvalSet(nb, index, set)) }];
for (const [name, spec] of Object.entries(LOCAL_MODELS)) {
  process.stderr.write(`\n== ${name} (~${spec.downloadMB} MB)\n`);
  const t0 = performance.now();
  const provider = await createLocalProvider({ model: name, cacheDir, allowDownload: true });
  const loadMs = Math.round(performance.now() - t0);
  rmSync(join(work, ".aimem/.cache"), { recursive: true, force: true });
  const t1 = performance.now();
  const built = await buildVectorCache(nb, index, provider, { fs: nodeFs, random });
  const buildMs = Math.round(performance.now() - t1);
  const t2 = performance.now();
  const report = await runEvalSet(nb, index, set, { provider, fs: nodeFs });
  const evalMs = Math.round(performance.now() - t2);
  rows.push({
    model: name,
    downloadMB: spec.downloadMB,
    dimensions: spec.dimensions,
    chunks: built.chunks,
    loadMs,
    buildMs,
    msPerQuery: Math.round(evalMs / set.cases.length),
    ...summarize(report),
    misses: report.cases.filter((c) => c.recall !== null && c.recall < 1).map((c) => c.id),
  });
}
rmSync(work, { recursive: true, force: true });

const cols = ["model", "downloadMB", "keyword", "paraphrase", "multilingual", "trap", "overall", "violations", "buildMs", "msPerQuery"];
console.log(cols.join("\t"));
for (const r of rows) console.log(cols.map((c) => r[c] ?? "").join("\t"));
mkdirSync(join(root, "fixtures/evals/results"), { recursive: true });
writeFileSync(
  join(root, "fixtures/evals/results/model-comparison.json"),
  `${JSON.stringify({ evalSet: "medium", cases: set.cases.length, k: set.k, rows }, null, 2)}\n`,
);
