// Briefing eval report (docs/12 §3). Usage: pnpm eval [--update-baseline]
// Runs fixtures/evals/<set>.yaml against the built core and compares with fixtures/evals/baseline/<set>.lexical.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, loadProject, nodeFs, runEvalSet } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";

const root = new URL("..", import.meta.url).pathname;
const name = "medium";
const set = YAML.parse(readFileSync(join(root, "fixtures/evals", `${name}.yaml`), "utf8"));
const nb = await loadProject(nodeFs, join(root, "fixtures/projects", set.project));
const report = await runEvalSet(nb, await loadIndex(nb, { fs: nodeFs }), set);
const baselineFile = join(root, "fixtures/evals/baseline", `${name}.lexical.json`);
const snapshot = {
  byCategory: report.byCategory,
  overall: report.overall,
  cases: report.cases.map((c) => ({ id: c.id, recall: c.recall, inBriefing: c.inBriefing })),
};
let baseline;
try {
  baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
} catch {
  baseline = undefined;
}
const delta = (now, then) => (then === undefined || now === then ? "" : ` (${now > then ? "+" : ""}${(now - then).toFixed(2)})`);
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("case", 24)}${pad("category", 14)}${pad("recall@" + set.k, 12)}${pad("shown", 8)}missing / violations`);
for (const c of report.cases) {
  const was = baseline?.cases.find((b) => b.id === c.id);
  console.log(
    `${pad(c.id, 24)}${pad(c.category, 14)}${pad(`${c.recall ?? "-"}${delta(c.recall, was?.recall)}`, 12)}${pad(c.inBriefing ?? "-", 8)}${[...c.missing, ...c.violations.map((v) => `!${v}`)].join(" ")}`,
  );
}
console.log("");
for (const [cat, s] of [...Object.entries(report.byCategory), ["overall", report.overall]]) {
  const was = cat === "overall" ? baseline?.overall : baseline?.byCategory[cat];
  console.log(`${pad(cat, 14)} n=${pad(s.n, 3)} recall@${set.k}=${s.recall}${delta(s.recall, was?.recall)}  shown=${s.inBriefing}  violations=${s.violations}`);
}
console.log(`budget ok ${report.overall.budgetOk * 100}% · deterministic ${report.overall.deterministic * 100}%`);
if (process.argv.includes("--update-baseline")) {
  mkdirSync(join(root, "fixtures/evals/baseline"), { recursive: true });
  writeFileSync(baselineFile, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`baseline written: ${baselineFile}`);
}
