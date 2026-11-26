import { cpus, loadavg } from "node:os";
import { ID_ALPHABET } from "../../../schema/dist/index.js";
import { emptyNotebook, P, remove, type Served, serve, writeRecord } from "./notebook.js";
import { expect, test } from "./test.js";

/**
 * The time budget of 24 §5.8 on 5,000 records: a cached page under 300 ms, a search under 600 ms. It runs alone
 * (`pnpm test:budget`, one worker), outside the parallel unit suite. Times are the server's answer as a client on
 * the same computer sees it, for the machine that runs the test. Each address is asked 7 times; the median counts.
 */
const RECORDS = 5000;
const PAGE_MS = 300;
const SEARCH_MS = 600;
const RUNS = 7;

const WORDS =
  "ledger webhook retry idempotent schema migration claim branch embedding briefing handoff decision agent token budget".split(
    " ",
  );
const KINDS = [
  { dir: "memory", type: "memory", prefix: "mem", status: "active", share: 3000 },
  { dir: "tasks", type: "task", prefix: "tsk", status: "review", share: 1000 },
  { dir: "decisions", type: "decision", prefix: "dec", status: "accepted", share: 500 },
  { dir: "handoffs", type: "handoff", prefix: "hnd", status: "final", share: 500 },
];
const id = (prefix: string, i: number) =>
  `${prefix}-${[...i.toString(32).padStart(8, "0")].map((c) => ID_ALPHABET[Number.parseInt(c, 32)]).join("")}`;

let dir = "";
let server: Served;
const addresses: [string, string, number][] = [];

test.beforeAll(async () => {
  test.setTimeout(180_000);
  dir = emptyNotebook();
  let n = 0;
  for (const k of KINDS)
    for (let i = 0; i < k.share; i++, n++) {
      const w = (j: number) => WORDS[(n * 7 + j * 3) % WORDS.length];
      writeRecord(dir, {
        dir: k.dir,
        id: id(k.prefix, n),
        type: k.type,
        status: k.status,
        title: `${w(1)} ${w(2)} note ${n}`,
        summary: `About ${w(3)} and ${w(4)} in record ${n}.`,
        roles: ["dev"],
        body: `${Array.from({ length: 150 }, (_, j) => w(j)).join(" ")}${n === 42 ? " quokka" : ""}`,
      });
    }
  expect(n).toBe(RECORDS);
  server = await serve(dir);
  const one = id("mem", 42);
  for (const [name, path] of [
    ["dashboard", P],
    ["dashboard with a lens", `${P}?lens=dev`],
    ["task board", `${P}/tasks`],
    ["tasks of one status", `${P}/tasks?status=review&page=3`],
    ["decisions", `${P}/decisions`],
    ["handoffs", `${P}/handoffs`],
    ["browse menu", `${P}/records`],
    ["list of one type", `${P}/records?type=memory&page=40`],
    ["record", `${P}/r/${one}`],
    ["import guide", `${P}/import`],
  ])
    addresses.push([name as string, path as string, PAGE_MS]);
  addresses.push(
    ["search: one hit", `${P}/search?q=quokka`, SEARCH_MS],
    ["search: every record", `${P}/search?q=ledger+webhook`, SEARCH_MS],
    ["search: with filters", `${P}/search?q=ledger&type=memory&role=dev&closed=1&page=5`, SEARCH_MS],
    ["search: no hit", `${P}/search?q=zzzznothing`, SEARCH_MS],
  );
});

test.afterAll(async () => {
  await server?.stop();
  if (dir) remove(dir);
});

test("5,000 records: cached pages and searches stay within the budget", async ({ request }) => {
  test.setTimeout(180_000);
  const timed = async (path: string) => {
    const t0 = performance.now();
    const r = await request.get(server.origin + path, { timeout: 60_000 });
    await r.body();
    expect(r.status(), path).toBe(200);
    return performance.now() - t0;
  };
  const cold = await timed(P);
  console.log(
    `${cpus().length} CPUs, load ${loadavg()[0]?.toFixed(1)}, node ${process.version}; first page ${Math.round(cold)} ms (not budgeted)`,
  );
  const rows: { name: string; median: number; max: number; budget: number }[] = [];
  for (const [name, path, budget] of addresses) {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) times.push(await timed(path));
    times.sort((a, b) => a - b);
    rows.push({
      name,
      median: Math.round(times[Math.floor(RUNS / 2)] as number),
      max: Math.round(times[RUNS - 1] as number),
      budget,
    });
  }
  for (const r of rows)
    console.log(`${r.name.padEnd(24)} median ${r.median} ms, max ${r.max} ms (budget ${r.budget})`);
  expect(rows.filter((r) => r.median >= r.budget)).toEqual([]);
});
