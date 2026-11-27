// Deliberate breakages of the 6.1a server (plan §7.2, CI-3). Each patch must apply, and the named tests must then
// fail. A patch that does not apply, or that the tests do not catch, fails the job. Run by the CI job
// `server-mutation` with PostgreSQL; the source is restored after each patch.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const S = "packages/server/src/";
const MUTATIONS = [
  {
    name: "holder taken from the body",
    file: `${S}validate.ts`,
    edits: [['const ACQUIRE_FIELDS = new Set(["task",', 'const ACQUIRE_FIELDS = new Set(["holder", "task",']],
    test: ["claims.test.ts", "bad bodies"],
  },
  {
    name: "scope not checked",
    file: `${S}auth.ts`,
    edits: [["if (!(row.scopes as string[]).includes(scope))", "if (false)"]],
    test: ["auth.test.ts", "permission matrix"],
  },
  {
    name: "token not bound to its project",
    file: `${S}auth.ts`,
    edits: [["if (row.slug !== slug || !row.member) throw notFound();", "if (!row.member) throw notFound();"]],
    test: ["auth.test.ts", "permission matrix"],
  },
  {
    name: "project filter dropped from overlaps",
    file: `${S}claims.ts`,
    edits: [["WHERE project_id = $1 AND released_at IS NULL AND paths IS NOT NULL AND task_ref <> $2", "WHERE ($1::bigint IS NOT NULL) AND released_at IS NULL AND paths IS NOT NULL AND split_part(task_ref, ':', 2) <> split_part($2, ':', 2)"]],
    test: ["claims.test.ts", "same task ID in two projects"],
  },
  {
    name: "owner without the user",
    file: `${S}decide.ts`,
    edits: [["a.userId === b.userId && a.holder === b.holder", "a.holder === b.holder"]],
    test: ["claims.test.ts", "same name and session"],
  },
  {
    name: "time of transaction start instead of after the lock",
    file: `${S}claims.ts`,
    edits: [['const t = (await c.query("SELECT clock_timestamp() AS t")).rows[0].t as Date;\n    const current', 'const t = (await c.query("SELECT now() AS t")).rows[0].t as Date;\n    const current']],
    test: ["claims.test.ts", "waits on the lock past expiry"],
  },
  {
    name: "no allowance after expiry",
    file: `${S}decide.ts`,
    edits: [["export const TAKEOVER_GRACE_MS = 5 * 60_000;", "export const TAKEOVER_GRACE_MS = 0;"]],
    test: ["claims.test.ts", "expiry table"],
  },
  {
    name: "expired claim free without steal",
    file: `${S}decide.ts`,
    edits: [["    if (!action.steal)\n", "    if (!action.steal && now < expires)\n"]],
    test: ["claims.test.ts", "expiry table"],
  },
  {
    name: "steal repeated by its owner is a conflict",
    file: `${S}decide.ts`,
    edits: [["      if (mine) return { do: \"same\" };", "      if (mine && !action.steal) return { do: \"same\" };"]],
    test: ["claims.test.ts", "lost response"],
  },
  {
    name: "heartbeat revives an expired claim",
    file: `${S}decide.ts`,
    edits: [['  if (!active) return { error: "conflict", message: "The claim has expired. Use steal when eligible." };\n', ""]],
    test: ["claims.test.ts", "expiry table"],
  },
  {
    name: "session not scanned for tokens",
    file: `${S}validate.ts`,
    edits: [
      ['  if (/^aimem_/i.test(session)) throw usage("A session ID must not start with aimem_.");\n  scan([session]);\n', ""],
      ["  scan([session, ...(paths ?? []), note ?? \"\"]);", "  scan([...(paths ?? []), note ?? \"\"]);"],
    ],
    test: ["claims.test.ts", "bad bodies"],
  },
  {
    name: "event written outside the claim transaction",
    file: `${S}claims.ts`,
    edits: [["    await c.query(\"INSERT INTO events (project_id, seq, type, payload, at) VALUES ($1, $2, $3, $4, $5)\", [", "    await this.pool.query(\"INSERT INTO events (project_id, seq, type, payload, at) VALUES ($1, $2, $3, $4, $5)\", ["]],
    test: ["events.test.ts", "written with the change"],
  },
  {
    name: "event number not locked until commit",
    file: `${S}claims.ts`,
    edits: [['"UPDATE project_event_seq SET last_seq = last_seq + 1 WHERE project_id = $1 RETURNING last_seq"', '"SELECT coalesce((SELECT max(seq) FROM events WHERE project_id = $1), 0) + 1 AS last_seq"']],
    test: ["events.test.ts", "commit order"],
  },
  {
    name: "unique index missing",
    file: "packages/server/migrations/001_init.sql",
    edits: [["CREATE UNIQUE INDEX claims_one_open ON claims (project_id, task_ref) WHERE released_at IS NULL;", "CREATE INDEX claims_one_open ON claims (project_id, task_ref) WHERE released_at IS NULL;"]],
    test: ["concurrency.test.ts", "unique index alone"],
  },
  {
    name: "task lock missing",
    file: `${S}claims.ts`,
    edits: [['await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [', 'await c.query("SELECT $1::text", [']],
    test: ["concurrency.test.ts", "really wait on the task lock"],
  },
];

const checkOnly = process.argv.includes("--check");
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const rows = [];
let bad = 0;
for (const m of MUTATIONS.filter((x) => !only || x.name.includes(only))) {
  const original = readFileSync(m.file, "utf8");
  let text = original;
  let applied = true;
  for (const [from, to] of m.edits) {
    if (!text.includes(from)) applied = false;
    text = text.replace(from, to);
  }
  if (!applied) {
    rows.push([m.name, "patch did not apply", "FAIL"]);
    bad++;
    continue;
  }
  if (checkOnly) {
    rows.push([m.name, "patch applies", "ok"]);
    continue;
  }
  writeFileSync(m.file, text);
  try {
    const r = spawnSync(
      "pnpm",
      ["exec", "vitest", "run", "--config", "vitest.server.config.ts", m.test[0], "-t", m.test[1]],
      { encoding: "utf8", env: process.env, timeout: 600_000 },
    );
    const caught = r.status !== 0 && /failed/i.test(`${r.stdout}${r.stderr}`);
    rows.push([m.name, `${m.test[0]} › ${m.test[1]}`, caught ? "caught" : "SURVIVED"]);
    if (!caught) bad++;
  } finally {
    writeFileSync(m.file, original);
  }
}
const table = ["| Mutation | Test | Result |", "|---|---|---|", ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
console.log(table);
writeFileSync("mutation-report.md", `${table}\n`);
process.exit(bad ? 1 : 0);
