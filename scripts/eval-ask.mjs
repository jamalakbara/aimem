// Answer evals for `aimem ask` (docs/12 §3, 15 §15; T5).
// Usage:
//   pnpm eval:ask --fake [--update-baseline]   deterministic tier (no model): retrieval recall vs the committed baseline
//   pnpm eval:ask                              real tier: claude -p (Claude Code login or ANTHROPIC_API_KEY), writes results
// Real-tier env: AIMEM_EVAL_MODEL (default sonnet), AIMEM_CLAUDE_BIN. The fixture records are fictional, but their
// text is sent to Anthropic through Claude Code.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  askEvalBaseline,
  execaRunner,
  loadAskEvalIndex,
  loadLlmProvider,
  loadProject,
  nodeFs,
  runAskEvalSet,
} from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const name = "ask-medium";
const fake = process.argv.includes("--fake");
const set = YAML.parse(readFileSync(join(root, "fixtures/evals", `${name}.yaml`), "utf8"));
const nb = await loadProject(nodeFs, join(root, "fixtures/projects", set.project));
const index = await loadAskEvalIndex(nb, nodeFs, set.overlay ? join(root, "fixtures/evals", set.overlay) : undefined);

let llm;
if (fake) {
  llm = { id: "fake", generate: async () => ({ text: "not found in the notebook" }) };
} else {
  const model = process.env.AIMEM_EVAL_MODEL || "sonnet";
  const status = loadLlmProvider(
    { retrieval: { llm: { provider: "claude-cli", allow_remote: true, model, timeout_seconds: 180 } } },
    { runner: execaRunner(), env: process.env },
  );
  if (!status.available) throw new Error(status.reason);
  llm = status.provider;
  console.log(`real tier: ${llm.id}, ${set.cases.length} cases (fixture text goes to Anthropic via claude -p)`);
}

const started = Date.now();
const report = await runAskEvalSet(nb, index, set, { llm });
const pad = (s, n) => String(s ?? "-").padEnd(n);
console.log(`${pad("case", 32)}${pad("category", 14)}${pad("recall", 8)}${pad("prec", 6)}flags / cited`);
for (const c of report.cases) {
  const flags = [
    c.refused === false ? "ANSWERED" : c.refused ? "refused" : "",
    c.trapWin ? "TRAP-WIN" : "",
    c.injected ? "INJECTED" : "",
    c.error ? `ERROR ${c.error}` : "",
  ].filter(Boolean);
  console.log(`${pad(c.id, 32)}${pad(c.category, 14)}${pad(c.retrievalRecall, 8)}${pad(c.citationPrecision, 6)}${[...flags, c.cited.join(",")].join(" ")}`);
}
const s = report.summary;
console.log(`\nretrieval recall: ${JSON.stringify(s.retrievalRecall)}`);
if (!fake)
  console.log(
    `citation precision ${s.citationPrecision} · refusal rate ${s.refusalRate} · trap-win rate ${s.trapWinRate} · injection resistance ${s.injectionResistance} · errors ${s.errors} · ${Math.round((Date.now() - started) / 1000)} s`,
  );

if (fake) {
  const file = join(root, "fixtures/evals/baseline", `${name}.lexical.json`);
  const now = askEvalBaseline(report);
  if (process.argv.includes("--update-baseline")) {
    mkdirSync(join(root, "fixtures/evals/baseline"), { recursive: true });
    writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`baseline written: ${file}`);
  } else {
    let was;
    try {
      was = JSON.parse(readFileSync(file, "utf8"));
    } catch {}
    console.log(JSON.stringify(was) === JSON.stringify(now) ? "matches baseline" : "DIFFERS from baseline (run with --update-baseline and report the deltas)");
  }
} else {
  const dir = join(root, "fixtures/evals/results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.${llm.id.replace(/[^a-z0-9.-]+/gi, "-")}.json`);
  writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), ...report }, null, 2)}\n`);
  console.log(`results written: ${file}`);
}
