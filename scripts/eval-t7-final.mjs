// End-to-end default retrieval comparison; prior facade suppresses only the corpus-term bridge.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import {
  buildVectorCache,
  createLocalProvider,
  loadIndex,
  loadProject,
  nodeFs,
  runEvalSet,
  semanticForQuery,
  buildQuery,
  loadVectorCache,
} from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";
const root = process.cwd(),
  work = mkdtempSync(join(tmpdir(), "aimem-t7-final-"));
try {
  cpSync(join(root, "fixtures/projects/medium"), work, { recursive: true });
  const nb = await loadProject(nodeFs, work),
    index = await loadIndex(nb, { fs: nodeFs }),
    provider = await createLocalProvider({
      model: "auto",
      allowDownload: false,
      cacheDir: join(process.env.AIMEM_HOME ?? join(homedir(), ".cache/aimem"), "models"),
    });
  const start = performance.now(),
    built = await buildVectorCache(nb, index, provider, {
      fs: nodeFs,
      random: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
    }),
    buildMs = Math.round(performance.now() - start);
  const prior = { ...provider, id: provider.id.replace(/^local:/, "prior:") },
    priorFs = {
      ...nodeFs,
      readFile: async (p) => {
        const text = await nodeFs.readFile(p);
        if (p.replaceAll("\\", "/").endsWith("/vectors/meta.json")) {
          const meta = JSON.parse(text);
          return JSON.stringify({ ...meta, provider: prior.id });
        }
        return text;
      },
    };
  const reports = [];
  for (const name of [
    "medium",
    "t7-heldout",
    "t7-query-heldout",
    "t7-calibration-heldout",
    "t7-final-heldout",
  ]) {
    const set = YAML.parse(readFileSync(join(root, `fixtures/evals/${name}.yaml`), "utf8")),
      lexical = await runEvalSet(nb, index, set),
      before = await runEvalSet(nb, index, set, { provider: prior, fs: priorFs }),
      after = await runEvalSet(nb, index, set, { provider, fs: nodeFs }),
      expansions = [];
    for (const c of set.cases) {
      const sem = await semanticForQuery(nb, index, provider, buildQuery(nb, index, c), { fs: nodeFs });
      if (sem.expansionTerm) expansions.push({ id: c.id, term: sem.expansionTerm });
    }
    reports.push({ name, lexical, before, after, expansions });
    console.log(
      JSON.stringify({
        name,
        lexical: lexical.byCategory,
        before: before.byCategory,
        after: after.byCategory,
        expansions,
      }),
    );
  }
  writeFileSync(
    join(root, "fixtures/evals/results/t7-final.json"),
    JSON.stringify(
      {
        model: provider.id,
        method:
          "Original document vectors and scoring versus production corpus-term bridge; prior: facade only suppresses bridge, same cache and embeddings",
        buildMs,
        built,
        cacheVersion: (await loadVectorCache(nodeFs, nb)).cache?.meta.version,
        parameters: { maxWords: 4096, minimumCosine: 0.4, minimumMargin: 0.01, wordFormCosine: 0.8 },
        reports,
      },
      null,
      2,
    ) + "\n",
  );
  const medium = reports.find((r) => r.name === "medium");
  if (
    medium.after.byCategory.paraphrase.recall - medium.lexical.byCategory.paraphrase.recall < 0.15 ||
    medium.after.byCategory.keyword.recall < medium.before.byCategory.keyword.recall ||
    medium.after.byCategory.multilingual.recall < medium.before.byCategory.multilingual.recall ||
    medium.after.byCategory.multilingual.recall <= medium.lexical.byCategory.multilingual.recall ||
    reports.some(
      (r) =>
        r.after.overall.recall < r.before.overall.recall ||
        r.after.overall.violations ||
        r.after.overall.budgetOk !== 1 ||
        r.after.overall.deterministic !== 1 ||
        r.after.cases.some((c) => c.unlabelled.length),
    )
  )
    throw new Error("T7 quality gates failed; do not ship this default");
} finally {
  if (
    !resolve(work).startsWith(`${resolve(tmpdir())}${sep}`) ||
    !basename(work).startsWith("aimem-t7-final-")
  )
    throw new Error("Refusing cleanup outside the temporary eval directory");
  rmSync(work, { recursive: true, force: true });
}
