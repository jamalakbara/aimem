// One-off migration (slice 2.7): docs/HANDOFF.md entries → .aimem/handoffs records, original dates kept.
// Usage: node scripts/migrate-handoffs.mjs [path/to/HANDOFF.md]   (run after pnpm build)
import { readFileSync } from "node:fs";
import { addRecord, cryptoRandom, loadProject, nodeFs } from "../packages/core/dist/index.js";

const root = new URL("..", import.meta.url).pathname;
const text = readFileSync(process.argv[2] ?? `${root}docs/HANDOFF.md`, "utf8");
const nb = await loadProject(nodeFs, root);
const entries = text.split(/^## (?=\d{4}-\d{2}-\d{2})/m).slice(1).reverse(); // file is newest first
const SECTIONS = ["Done", "Not done", "Next", "Blocked", "Notes for next agent"];
const first = (s) => (s.split("\n").find((l) => l.trim()) ?? "").replace(/^\s*[-*+]\s+/, "").trim();
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const seen = new Map();
for (const entry of entries) {
  const [heading, ...rest] = entry.split("\n");
  const m = /^(\d{4}-\d{2}-\d{2}) — (.+?)(?: \(branch `([^`]+)`.*\))?$/.exec(heading.trim());
  if (!m) throw new Error(`unrecognised heading: ${heading}`);
  const [, date, what, branch] = m;
  const body = rest.join("\n");
  const section = (name) => {
    const r = new RegExp(`^### ${name}(?: \\([^)]*\\))?\\s*\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m").exec(body);
    return r?.[1].trim() || "none";
  };
  const n = (seen.get(date) ?? 0) + 1; // keep the original order within a day
  seen.set(date, n);
  const at = new Date(`${date}T08:${String(n).padStart(2, "0")}:00Z`);
  const r = await addRecord(
    nb,
    {
      type: "handoff",
      title: cut(`Handoff ${date}: ${what}`, 120),
      summary: cut(`Done: ${what} · Next: ${first(section("Next"))}`, 200),
      body: SECTIONS.map((s) => `## ${s}\n${section(s)}`).join("\n\n"),
      author: "agent:claude-code",
      fields: branch ? { branch } : {},
    },
    { fs: nodeFs, clock: { now: () => at }, random: cryptoRandom },
  );
  console.log(`${r.ref}  ${date}  ${what}`);
}
