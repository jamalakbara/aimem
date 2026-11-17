// Test whether accepted decisions' durable validity should avoid an activity-recency penalty.
// No production defaults change. Both lexical and hybrid baselines use each experimental policy.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildBriefing, buildQuery, buildVectorCache, createLocalProvider, loadIndex, loadProject,
  nodeFs, scoreCandidates, semanticForQuery } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";
const work = mkdtempSync(join(tmpdir(), "aimem-durable-"));
try {
  cpSync(new URL("../fixtures/projects/medium", import.meta.url), work, { recursive: true });
  const nb = await loadProject(nodeFs, work);
  const index = await loadIndex(nb, { fs: nodeFs });
  const provider = await createLocalProvider({ model: "auto", allowDownload: false,
    cacheDir: join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models") });
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: { bytes: n => crypto.getRandomValues(new Uint8Array(n)) } });
  const reports = [];
  for (const name of ["medium", "t7-heldout", "t7-query-heldout"]) {
    const set = YAML.parse(readFileSync(new URL(`../fixtures/evals/${name}.yaml`, import.meta.url), "utf8"));
    const rows = [];
    for (const c of set.cases) {
      const now = new Date(set.clock);
      const input = { ...(c.task ? { task: c.task } : {}), ...(c.paths ? { paths: c.paths } : {}), ...(c.ref ? { ref: c.ref } : {}) };
      const semantic = await semanticForQuery(nb, index, provider, buildQuery(nb, index, input), { fs: nodeFs });
      for (const mode of ["lexical", "hybrid"]) {
        const request = mode === "hybrid" ? { ...input, semantic } : input;
        const scored = scoreCandidates(nb, index, request, now);
        for (const policy of ["original", "accepted", "verified", "floor"]) {
          const candidates = scored.candidates.map(candidate => {
            const r = candidate.record;
            if (policy === "original" || r.type !== "decision" || r.status !== "accepted" || (policy === "verified" && r.trust !== "verified")) return candidate;
            const p = candidate.parts;
            const recency = policy === "floor" ? Math.max(0.5, p.recency) : 1;
            return { ...candidate, parts: { ...p, recency, total: Math.round((p.total + 0.1 * (recency - p.recency) * p.trust * p.freshness) * 10000) / 10000 } };
          }).sort((a,b) => b.parts.total - a.parts.total || a.record.id.localeCompare(b.record.id));
          const b = buildBriefing(nb, index, request, now, { ...scored, candidates });
          const top = b.explain.slice(0, set.k).map(x => x.ref);
          rows.push({ id: c.id, category: c.category, mode, policy, recall: c.must_include.filter(ref => top.includes(ref)).length / c.must_include.length,
            missing: c.must_include.filter(ref => !top.includes(ref)), budgetOk: b.header.used <= b.header.budget,
            violations: (c.must_not_include ?? []).filter(ref => b.explain.some(x => x.ref === ref && x.section !== "omitted")) });
        }
      }
    }
    const summary = {};
    for (const policy of ["original", "accepted", "verified", "floor"]) {
      summary[policy] = {};
      for (const mode of ["lexical", "hybrid"]) {
        summary[policy][mode] = {};
        for (const category of ["all", "keyword", "paraphrase", "multilingual", "trap"]) {
          const cases = rows.filter(r => r.policy === policy && r.mode === mode && (category === "all" || r.category === category));
          if (cases.length) summary[policy][mode][category] = cases.reduce((sum,c) => sum + c.recall, 0) / cases.length;
        }
      }
    }
    reports.push({ name, summary, rows });
    console.log(JSON.stringify({ name, summary }));
  }
  writeFileSync(new URL("../fixtures/evals/results/t7-durable-policy.json", import.meta.url), JSON.stringify({ reports }, null, 2) + "\n");
} finally { rmSync(work, { recursive: true, force: true }); }
