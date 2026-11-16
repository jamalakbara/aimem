// Actual ask retrieval with real reranking and a stub final answer; no API key required.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASK_RULES, askQuestion, buildVectorCache, createClaudeCliProvider, createLocalProvider, cryptoRandom, execaRunner, loadIndex, loadProject, nodeFs, semanticForQuery } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

if (!process.argv.includes("--real")) throw new Error("Pass --real to send synthetic fixtures through your Claude Code login.");
delete process.env.ANTHROPIC_API_KEY;
const root = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "aimem-ask-rerank-"));
const dir = join(root, "fixtures/evals/results");
mkdirSync(dir, { recursive: true });
const out = join(dir, "rerank-ask-claude-cli.json");
const model = process.env.AIMEM_EVAL_MODEL || "sonnet";
const real = createClaudeCliProvider({ runner: execaRunner(), command: process.env.AIMEM_CLAUDE_BIN || "claude", model, timeoutMs: 120000 });
const stub = { id: "stub-answer", generate: async () => ({ text: "not found in the notebook" }) };
const report = { date: new Date().toISOString(), model, path: "askQuestion", answer: "stub", candidateLimit: 50, topK: 10, cases: [] };
try {
  cpSync(join(root, "fixtures/projects/medium"), work, { recursive: true });
  const nb = await loadProject(nodeFs, work);
  const index = await loadIndex(nb, { fs: nodeFs });
  const enabled = { ...nb, config: { ...nb.config, retrieval: { ...nb.config.retrieval, rerank: "llm", llm: { allow_remote: true } } } };
  const provider = await createLocalProvider({ model: "auto", cacheDir: join(process.env.AIMEM_HOME || join(homedir(), ".cache/aimem"), "models"), allowDownload: false });
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: cryptoRandom });
  for (const name of ["medium", "rerank-heldout"]) {
    const set = YAML.parse(readFileSync(join(root, `fixtures/evals/${name}.yaml`), "utf8"));
    for (const q of set.cases) {
      // Use the raw question, as the ask CLI does (no context paths/ref expansion).
      const semantic = await semanticForQuery(nb, index, provider, q.task, { fs: nodeFs });
      if (!("scores" in semantic)) throw new Error(semantic.reason);
      const options = { limit: 10, role: q.role, llm: stub };
      const lexical = await askQuestion(nb, index, q.task, options);
      const baseline = await askQuestion(nb, index, q.task, { ...options, semantic });
      let calls = 0, latencyMs = 0, usage;
      const llm = { id: real.id, generate: async request => {
        if (request.system === ASK_RULES) return stub.generate(request);
        calls++;
        const start = Date.now();
        try { const result = await real.generate(request); usage = result.usage; return result; }
        finally { latencyMs += Date.now() - start; }
      } };
      const result = await askQuestion(enabled, index, q.task, { ...options, semantic, llm });
      const recall = refs => q.must_include.filter(ref => refs.includes(ref)).length / q.must_include.length;
      const row = { set: name, id: q.id, category: q.category, lexical: recall(lexical.framed), baseline: recall(baseline.framed), reranked: recall(result.framed), calls, latencyMs, usage, warnings: result.warnings, missing: q.must_include.filter(ref => !result.framed.includes(ref)), violations: (q.must_not_include || []).filter(ref => result.framed.includes(ref)), top: result.framed };
      report.cases.push(row);
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`${name}/${q.id}: ${row.baseline} -> ${row.reranked}; ${latencyMs}ms; ${row.warnings.join("; ")}`);
      if (report.cases.length === 1 && result.warnings.length) throw new Error("First rerank failed; stopping batch.");
    }
  }
  for (const name of ["medium", "rerank-heldout"]) {
    const rows = report.cases.filter(r => r.set === name);
    for (const category of ["all", ...new Set(rows.map(r => r.category))]) {
      const group = rows.filter(r => category === "all" || r.category === category);
      console.log(name, category, Object.fromEntries(["lexical", "baseline", "reranked", "latencyMs"].map(k => [k, group.reduce((sum, r) => sum + r[k], 0) / group.length])));
    }
  }
  console.log(`Results: ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
