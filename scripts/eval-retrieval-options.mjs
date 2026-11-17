// Compare the same synthetic answer cases in three opt-in configurations.
// Explicit --real required; uses Claude Code login, never an API key.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createLocalRanker, execaRunner, loadAskEvalIndex, loadLlmProvider, loadProject, nodeFs, runAskEvalSet } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";
if (!process.argv.includes("--real")) throw new Error("Pass --real to send synthetic records to Claude Code for this evaluation.");
delete process.env.ANTHROPIC_API_KEY;
const set = YAML.parse(readFileSync(new URL("../fixtures/evals/ask-medium.yaml", import.meta.url), "utf8"));
const nb = await loadProject(nodeFs, fileURLToPath(new URL("../fixtures/projects/medium", import.meta.url)));
const index = await loadAskEvalIndex(nb, nodeFs, fileURLToPath(new URL("../fixtures/evals/ask-medium.overlay", import.meta.url)));
const status = loadLlmProvider({ retrieval: { llm: { provider: "claude-cli", allow_remote: true, model: process.env.AIMEM_EVAL_MODEL || "sonnet", timeout_seconds: 180 } } }, { runner: execaRunner(), env: process.env });
if (!status.available) throw new Error(status.reason);
try {
  await status.provider.generate({ system: "Return only READY. Do not use tools.", prompt: "READY", refCount: 0 });
} catch {
  writeFileSync(new URL("../fixtures/evals/results/ask-retrieval-options.json", import.meta.url), JSON.stringify({ status: "blocked", reason: "Claude Code real-answer preflight failed; no quality metrics are valid", reports: [] }, null, 2) + "\n");
  throw new Error("Real-answer preflight failed; sign in through claude /login before retrying.");
}
const ranker = await createLocalRanker({ cacheDir: join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models"), allowDownload: false });
const reports = [];
for (const mode of ["baseline", "rewrite", "cross-encoder"]) {
  nb.config.retrieval = { llm: { allow_remote: true }, query_rewrite: mode === "rewrite" ? "llm" : "none", rerank: mode === "cross-encoder" ? "cross-encoder" : "none" };
  const started = performance.now();
  // A complete report uses the existing metrics and unchanged supporting-ref lists.
  const llm = { ...status.provider, generate: async req => {
    const result = await status.provider.generate(req);
    process.stderr.write(`${mode}: ${req.refCount === 0 ? "rewrite" : "answer"} completed\n`);
    return result;
  } };
  const report = await runAskEvalSet(nb, index, set, { llm, ranker });
  reports.push({ mode, valid: report.summary.errors === 0, ms: Math.round(performance.now() - started), ...report });
  writeFileSync(new URL("../fixtures/evals/results/ask-retrieval-options.json", import.meta.url), JSON.stringify({ date: new Date().toISOString(), reports }, null, 2) + "\n");
  console.log(JSON.stringify({ mode, summary: report.summary }));
  if (report.summary.errors) throw new Error("Evaluation provider failed; refusing further comparisons or quality claims.");
}
