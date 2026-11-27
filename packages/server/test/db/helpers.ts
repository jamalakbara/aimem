import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createPool,
  createToken,
  type Hooks,
  migrate,
  type Pool,
  type RunningServer,
  startServer,
} from "@aimem/server";

/**
 * Database tests never skip (plan §7.2, QA W9): without `AIMEM_TEST_DATABASE_URL` they fail. The CI job
 * `server` provides PostgreSQL; other jobs do not include these files at all.
 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.AIMEM_TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "AIMEM_TEST_DATABASE_URL is not set: server database tests run in the CI job `server` and never skip.",
    );
  return url;
}

export interface TestDb {
  url: string;
  pool: Pool;
  drop(): Promise<void>;
}

/** A new database per test file, migrated; dropped afterwards. */
export async function freshDb(): Promise<TestDb> {
  const admin = createPool(testDatabaseUrl(), 1);
  const name = `aimem_t_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  const pool = createPool(url.toString(), 6);
  pool.on("error", () => undefined);
  await migrate(pool);
  return {
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** A random task ID; 40 bits make a repeat within one test run negligible. */
export function newTask(): string {
  let id = "";
  for (const b of randomBytes(8)) id += ALPHABET[b % 32];
  return `tsk-${id}`;
}

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  // biome-ignore lint/suspicious/noExplicitAny: tests read JSON of any shape
  json: any;
}

export async function call(
  base: string,
  o: {
    method: string;
    path: string;
    token?: string;
    session?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<Reply> {
  const r = await fetch(`${base}${o.path}`, {
    method: o.method,
    headers: {
      ...(o.token !== undefined ? { Authorization: `Bearer ${o.token}` } : {}),
      ...(o.session !== undefined ? { "Aimem-Session": o.session } : {}),
      ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...o.headers,
    },
    ...(o.body !== undefined ? { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) } : {}),
  });
  const text = await r.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: r.status, headers: r.headers, text, json };
}

/** A client bound to one server, project and token. */
export function client(base: string, slug: string, token: string, session = "s-1") {
  return {
    token,
    session,
    live: () => call(base, { method: "GET", path: `/v1/projects/${slug}/live`, token }),
    acquire: (body: Record<string, unknown>, s = session) =>
      call(base, { method: "POST", path: `/v1/projects/${slug}/claims`, token, session: s, body }),
    heartbeat: (task: string, s = session) =>
      call(base, { method: "PUT", path: `/v1/projects/${slug}/claims/${task}/heartbeat`, token, session: s }),
    release: (task: string, s = session) =>
      call(base, { method: "DELETE", path: `/v1/projects/${slug}/claims/${task}`, token, session: s }),
  };
}

export async function token(
  pool: Pool,
  project: string,
  user: string,
  o: { kind?: "human" | "agent"; name?: string; scopes?: string[]; expiresAt?: Date } = {},
): Promise<string> {
  return (
    await createToken(pool, {
      project,
      user,
      kind: o.kind ?? "human",
      ...(o.name ? { name: o.name } : {}),
      scopes: o.scopes ?? ["read", "write:live"],
      ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}),
    })
  ).token;
}

export async function server(db: TestDb, hooks?: Hooks, log?: (l: string) => void): Promise<RunningServer> {
  return startServer({ pool: db.pool, ...(hooks ? { hooks } : {}), ...(log ? { log } : {}) });
}

/** A second instance with its own pool on the same database. */
export async function secondServer(db: TestDb, hooks?: Hooks): Promise<RunningServer> {
  return startServer({ databaseUrl: db.url, poolMax: 6, ...(hooks ? { hooks } : {}) });
}

const BIN = fileURLToPath(new URL("../../dist/bin.js", import.meta.url));

/** The built server in its own process (KL-1, BR-2). */
export async function processServer(db: TestDb) {
  const proc = spawn(process.execPath, [BIN, "serve", "--port", "0"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: db.url },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d;
  });
  const url = await new Promise<string>((done, fail) => {
    proc.stdout.on("data", (d) => {
      stdout += d;
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (m?.[1]) done(m[1]);
    });
    proc.on("exit", (c) => fail(new Error(`server exited ${c}: ${stderr}`)));
  });
  return {
    url,
    output: () => stdout + stderr,
    stop: () =>
      new Promise<void>((done) => {
        proc.on("exit", () => done());
        proc.kill("SIGTERM");
      }),
  };
}

/** Holds the advisory lock of a task in its own transaction until `release()` (KL-3, KL-5, KL-6). */
export async function holdTaskLock(db: TestDb, key: string) {
  const c = await db.pool.connect();
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  return {
    release: async () => {
      await c.query("COMMIT");
      c.release();
    },
  };
}

/** Waits until `n` sessions wait for an advisory lock: proof that requests really overlap. */
export async function waitForLockWaiters(db: TestDb, n: number, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await db.pool.query(
      "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
    );
    if (r.rows[0].n >= n) return;
    await new Promise((d) => setTimeout(d, 20));
  }
  throw new Error(`fewer than ${n} requests waited for the lock`);
}

export const sleep = (ms: number) => new Promise((d) => setTimeout(d, ms));

/** Plan §1 invariants: one open claim per task, one event and one audit row per change, no gaps in seq. */
export async function assertInvariants(pool: Pool): Promise<void> {
  const open = await pool.query(
    "SELECT project_id, task_ref, count(*)::int AS n FROM claims WHERE released_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1",
  );
  if (open.rowCount) throw new Error(`more than one open claim: ${JSON.stringify(open.rows)}`);
  const seq = await pool.query(
    `SELECT p.project_id, p.last_seq, count(e.seq)::bigint AS n, coalesce(max(e.seq), 0) AS max
       FROM project_event_seq p LEFT JOIN events e ON e.project_id = p.project_id GROUP BY 1, 2`,
  );
  for (const r of seq.rows)
    if (String(r.n) !== String(r.last_seq) || String(r.max) !== String(r.last_seq))
      throw new Error(`events of project ${r.project_id} have gaps: ${JSON.stringify(r)}`);
  const pairs = await pool.query(
    `SELECT (SELECT count(*) FROM events)::int AS events,
            (SELECT count(*) FROM audit_log WHERE action LIKE 'claim.%')::int AS audit`,
  );
  if (pairs.rows[0].events !== pairs.rows[0].audit)
    throw new Error(`events and audit rows differ: ${JSON.stringify(pairs.rows[0])}`);
}

/** Counts of the tables that a refused request must not change. */
export async function counts(pool: Pool) {
  const r = await pool.query(
    `SELECT (SELECT count(*) FROM claims)::int AS claims, (SELECT count(*) FROM events)::int AS events,
            (SELECT count(*) FROM audit_log WHERE action LIKE 'claim.%')::int AS audit`,
  );
  return r.rows[0] as { claims: number; events: number; audit: number };
}

/** Moves a claim's time back so that it is active, expired within the allowance, or past it (KL-4). */
export async function age(pool: Pool, task: string, minutesAgo: number): Promise<void> {
  await pool.query(
    `UPDATE claims SET started_at = clock_timestamp() - make_interval(secs => $2::float8 * 60),
                       heartbeat_at = clock_timestamp() - make_interval(secs => $2::float8 * 60),
                       expires_at = clock_timestamp() - make_interval(secs => $2::float8 * 60) + make_interval(mins => ttl_minutes)
      WHERE task_ref = $1 AND released_at IS NULL`,
    [task, minutesAgo],
  );
}
