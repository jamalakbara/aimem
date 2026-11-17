// Synthetic fixtures only. Explicit --download permits the optional model download.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildQuery, buildBriefing, buildVectorCache, createLocalProvider, createLocalRanker,
  loadIndex, loadProject, nodeFs, rerankContextCandidates, scoreCandidates, semanticForQuery } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";
const model = process.argv.find(a => a.startsWith("--model="))?.split("=")[1] ?? "minilm";
const cacheDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");
const start = performance.now();
const ranker = await createLocalRanker({ cacheDir, model, allowDownload: process.argv.includes("--download") });
const loadMs = Math.round(performance.now() - start);
const work = mkdtempSync(join(tmpdir(), "aimem-ranker-"));
try {
  cpSync(new URL("../fixtures/projects/medium", import.meta.url), work, { recursive: true });
  const nb = await loadProject(nodeFs, work);
  const index = await loadIndex(nb, { fs: nodeFs });
  const provider = await createLocalProvider({ model: "auto", cacheDir, allowDownload: false });
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) } });
  const results = [];
  for (const name of ["medium", "t7-heldout"]) {
    const set = YAML.parse(readFileSync(new URL(`../fixtures/evals/${name}.yaml`, import.meta.url), "utf8"));
    for (const c of set.cases) {
      const input = { task: c.task, ...(c.paths ? { paths: c.paths } : {}), ...(c.ref ? { ref: c.ref } : {}) };
      const query = buildQuery(nb, index, input);
      const semantic = await semanticForQuery(nb, index, provider, query, { fs: nodeFs });
      if (!semantic.scores) throw new Error(semantic.reason);
      input.semantic = semantic;
      const now = new Date(set.clock);
      const scored = scoreCandidates(nb, index, input, now);
      const t0 = performance.now();
      const ranked = await rerankContextCandidates(scored.candidates, query, ranker);
      const ms = Math.round(performance.now() - t0);
      const briefing = buildBriefing(nb, index, input, now, { ...scored, candidates: ranked.candidates });
      const top = briefing.explain.slice(0, 10).map(r => r.ref);
      const all = briefing.explain.filter(r => r.section !== "omitted").map(r => r.ref);
      const recall = c.must_include.filter(ref => top.includes(ref)).length / c.must_include.length;
      const baseline = c.must_include.filter(ref => scored.candidates.slice(0, 10).some(x => x.record.id === ref)).length / c.must_include.length;
      results.push({ set: name, case: c.id, category: c.category, baseline, recall, ms, budgetOk: briefing.header.used <= briefing.header.budget, violations: (c.must_not_include ?? []).filter(ref => all.includes(ref)), ...(ranked.warning ? { warning: ranked.warning } : {}) });
      process.stderr.write(`${model} ${name} ${c.id}: ${baseline} -> ${recall} (${ms}ms)\n`);
    }
  }
  const summaries = {};
  for (const set of ["medium", "t7-heldout"]) {
    summaries[set] = {};
    for (const category of ["all", "keyword", "paraphrase", "multilingual", "trap"]) {
      const rows = results.filter(r => r.set === set && (category === "all" || r.category === category));
      if (rows.length) summaries[set][category] = { n: rows.length, baseline: rows.reduce((a,r) => a + r.baseline, 0) / rows.length, recall: rows.reduce((a,r) => a + r.recall, 0) / rows.length };
    }
  }
  const report = { model, loadMs, summaries, results };
  writeFileSync(new URL(`../fixtures/evals/results/local-ranker-${model}.json`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ model, loadMs, summaries }));
} finally { rmSync(work, { recursive: true, force: true }); }
