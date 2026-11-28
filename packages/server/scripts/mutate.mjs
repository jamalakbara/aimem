// Deliberate breakages of the 6.1 server (plan §7.2, CI-3). Each patch must apply, and the named tests must then
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
    edits: [["WHERE project_id = $1 AND released_at IS NULL AND paths IS NOT NULL AND task_ref <> $2", "WHERE $1::bigint IS NOT NULL AND released_at IS NULL AND paths IS NOT NULL AND task_ref <> $2"]],
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
    test: ["events.test.ts", "takes the event back too"],
  },
  {
    name: "event number not locked until commit",
    file: `${S}claims.ts`,
    edits: [['"UPDATE project_event_seq SET last_seq = last_seq + 1 WHERE project_id = $1 RETURNING last_seq"', '"SELECT coalesce((SELECT max(seq) FROM events WHERE project_id = $1), 0) + 1 AS last_seq"']],
    test: ["events.test.ts", "commit order"],
  },
  {
    name: "lost COMMIT confirmation reported as nothing saved",
    file: `${S}server.ts`,
    edits: [["  if (e instanceof CommitUncertain)", "  if (e instanceof CommitUncertain && false)"]],
    test: ["claims.test.ts", "confirmation is lost"],
  },
  {
    name: "removed member still accepted",
    file: `${S}auth.ts`,
    edits: [["if (row.slug !== slug || !row.member) throw notFound();", "if (row.slug !== slug) throw notFound();"]],
    test: ["auth.test.ts", "every refusal leaves the stored state"],
  },
  // 6.1b, SSE (CI-3: since wrong, NOTIFY dropped, access re-check in SSE dropped; plus the stream's own guards).
  {
    name: "since ignored (stream starts at the latest event)",
    file: `${S}sse.ts`,
    edits: [["      last = cursor ?? top;", "      last = top;"]],
    test: ["stream.test.ts", "exactly the changes after that answer"],
  },
  {
    name: "Last-Event-ID does not win over since",
    file: `${S}sse.ts`,
    edits: [["  return fromHeader ?? fromQuery;", "  return fromQuery ?? fromHeader;"]],
    test: ["stream.test.ts", "resumes on another one with Last-Event-ID"],
  },
  {
    name: "NOTIFY dropped",
    file: `${S}claims.ts`,
    edits: [["    await c.query(\"SELECT pg_notify('aimem_events', $1)\", [", "    await c.query(\"SELECT $1::text\", ["]],
    test: ["stream.test.ts", "delivers created, heartbeat and released"],
  },
  {
    name: "access re-check in SSE dropped",
    file: `${S}sse.ts`,
    edits: [["  return r.rows.length === 1;", "  return r.rows.length >= 0;"]],
    test: ["stream.test.ts", "the next event is not sent and the stream closes"],
  },
  {
    name: "project filter dropped from the stream",
    file: `${S}sse.ts`,
    edits: [["FROM events e WHERE e.project_id = $1 AND e.seq > $2::bigint", "FROM events e WHERE $1::bigint IS NOT NULL AND e.seq > $2::bigint"]],
    test: ["stream.test.ts", "never gets an event of beta"],
  },
  {
    name: "backlog ordered as text",
    file: `${S}sse.ts`,
    edits: [["ORDER BY e.seq LIMIT $3", "ORDER BY seq LIMIT $3"]],
    test: ["stream.test.ts", "sends the backlog in numeric order"],
  },
  {
    name: "no reconnect after the LISTEN connection is cut",
    file: `${S}events.ts`,
    edits: [["      void this.connect();\n", ""]],
    test: ["stream.test.ts", "still arrives within 3 s"],
  },
  {
    name: "stream slot not returned",
    file: `${S}sse.ts`,
    edits: [["      this.open--;\n", ""]],
    test: ["stream.test.ts", "frees its slot"],
  },
  // 6.1b sweeper (todo 20): claim stays recorded, claim.expired once, decided again under the task lock.
  {
    name: "sweeper releases the claim",
    file: `${S}claims.ts`,
    edits: [["UPDATE claims SET expired_notified_at = $2 WHERE id = $1", "UPDATE claims SET expired_notified_at = $2, released_at = $2, released_status = 'released' WHERE id = $1"]],
    test: ["sweeper.test.ts", "marks an expired claim once"],
  },
  {
    name: "claim.expired written more than once",
    file: `${S}claims.ts`,
    edits: [
      [" AND released_at IS NULL AND expired_notified_at IS NULL\",", " AND released_at IS NULL\","],
      ["WHERE released_at IS NULL AND expired_notified_at IS NULL AND expires_at", "WHERE released_at IS NULL AND expires_at"],
      ["if (!current || !expireDue(open(current), current.expired_notified_at, t))", "if (!current || !expireDue(open(current), null, t))"],
    ],
    test: ["sweeper.test.ts", "marks an expired claim once"],
  },
  {
    name: "sweeper does not decide again under the lock",
    file: `${S}claims.ts`,
    edits: [["if (!current || !expireDue(open(current), current.expired_notified_at, t))", "if (!current || current.expired_notified_at)"]],
    test: ["sweeper.test.ts", "heartbeat first"],
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
const runTest = ([file, name]) =>
  spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.server.config.ts", file, "-t", name], {
    encoding: "utf8",
    env: process.env,
    timeout: 600_000,
  });
// A target test that already fails without a patch would make every patch look caught (QA 6.1b Q3): each
// target must pass unpatched first.
const baseline = new Map();
for (const m of MUTATIONS.filter((x) => !only || x.name.includes(only))) {
  const key = m.test.join(" › ");
  if (!checkOnly && !baseline.has(key)) {
    const r = runTest(m.test);
    baseline.set(key, r.status === 0 && /passed/i.test(`${r.stdout}${r.stderr}`));
  }
  if (!checkOnly && !baseline.get(key)) {
    rows.push([m.name, `${key} fails without the patch`, "FAIL"]);
    bad++;
    continue;
  }
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
    const r = runTest(m.test);
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
