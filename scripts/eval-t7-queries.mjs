// Local-only phrase-query experiments; uses cached default embeddings, no default/code changes.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildBriefing, buildQuery, buildVectorCache, createLocalProvider, loadIndex, loadProject,
  loadVectorCache, nodeFs, scoreCandidates, semanticScores } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

function phrases(query) {
  const words = query.trim().split(/\s+/);
  if (words.length <= 5) return [query];
  const windows = [];
  for (let i = 0; i + 4 < words.length; i += 3) windows.push(words.slice(i, i + 4).join(" "));
  windows.push(words.slice(-4).join(" "));
  const useful = [...new Set(windows)].filter(q => q.length >= 18 && q !== query);
  return [query, ...useful.slice(0, 2), ...useful.slice(2).slice(-1)];
}
const work = mkdtempSync(join(tmpdir(), "aimem-query-"));
try {
  cpSync(new URL("../fixtures/projects/medium", import.meta.url), work, { recursive: true });
  const nb = await loadProject(nodeFs, work);
  const index = await loadIndex(nb, { fs: nodeFs });
  const provider = await createLocalProvider({ model: "auto", allowDownload: false,
    cacheDir: join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models") });
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) } });
  const { cache } = await loadVectorCache(nodeFs, nb);
  const reports = [];
  for (const setName of ["medium", "t7-heldout", "t7-query-heldout"]) {
    const set = YAML.parse(readFileSync(new URL(`../fixtures/evals/${setName}.yaml`, import.meta.url), "utf8"));
    const rows = [];
    for (const c of set.cases) {
      const now = new Date(set.clock);
      const input = { ...(c.task ? { task: c.task } : {}), ...(c.paths ? { paths: c.paths } : {}), ...(c.ref ? { ref: c.ref } : {}) };
      const query = buildQuery(nb, index, input);
      const queries = phrases(query);
      const maps = [];
      for (const q of queries) maps.push(await semanticScores(cache, provider, q));
      const variants = { lexical: undefined, hybrid: maps[0], phraseMax: new Map(), phraseMean: new Map(), phraseMin: new Map(), phraseRrf: new Map() };
      const ranks = maps.map(m => new Map([...m.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ref],i) => [ref,i+1])));
      for (const ref of new Set(maps.flatMap(m => [...m.keys()]))) {
        variants.phraseMin.set(ref, Math.min(...maps.map(m => m.get(ref) ?? 0)));
        variants.phraseRrf.set(ref, ranks.reduce((sum,r) => sum + 1 / (60 + (r.get(ref) ?? index.records.length)), 0));
        variants.phraseMax.set(ref, Math.max(...maps.map(m => m.get(ref) ?? 0)));
        variants.phraseMean.set(ref, maps.reduce((s,m) => s + (m.get(ref) ?? 0), 0) / maps.length);
      }
      for (const [variant, scores] of Object.entries(variants)) {
        const request = scores ? { ...input, semantic: { scores, provider: provider.id, coverage: 1 } } : input;
        const b = buildBriefing(nb, index, request, now);
        const again = buildBriefing(nb, index, request, now);
        const top = b.explain.slice(0, set.k).map(x => x.ref);
        rows.push({ case: c.id, category: c.category, variant, queries,
          recall: c.must_include.filter(ref => top.includes(ref)).length / c.must_include.length,
          missing: c.must_include.filter(ref => !top.includes(ref)),
          violations: (c.must_not_include ?? []).filter(ref => b.explain.some(x => x.ref === ref && x.section !== "omitted")),
          budgetOk: b.header.used <= b.header.budget, deterministic: b.markdown === again.markdown });
      }
    }
    const summary = {};
    for (const variant of ["lexical", "hybrid", "phraseMax", "phraseMean", "phraseMin", "phraseRrf"]) {
      summary[variant] = {};
      for (const category of ["all", "keyword", "paraphrase", "multilingual", "trap"]) {
        const cases = rows.filter(r => r.variant === variant && (category === "all" || r.category === category));
        if (cases.length) summary[variant][category] = cases.reduce((sum,c) => sum + c.recall, 0) / cases.length;
      }
    }
    reports.push({ set: setName, summary, cases: rows });
    console.log(JSON.stringify({ set: setName, summary }));
  }
  writeFileSync(new URL("../fixtures/evals/results/t7-query-phrases.json", import.meta.url), JSON.stringify({ reports }, null, 2) + "\n");
} finally { rmSync(work, { recursive: true, force: true }); }
