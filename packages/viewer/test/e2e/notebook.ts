import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Throw-away notebooks and a viewer from the built CLI, for the browser tests (24 §5.8). All data is made up. */

const BIN = fileURLToPath(new URL("../../../cli/dist/bin.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../../fixtures/projects/", import.meta.url));

export const PROJECT = "aimem";
export const P = `/p/${PROJECT}`;

/** Records added to `medium` for the cases it does not have. */
export const IDS = {
  hostile: "mem-e2e00001",
  rich: "mem-e2e00002",
  doc: "dec-e2e00003",
  sheet: "tsk-e2e00004",
  upload: "tst-e2e00005",
  badUrl: "mem-e2e00006",
  expired: "mem-e2e00007",
  shared: "mem-e2e00008",
  moved: "mem-e2e00009",
  huge: "mem-e2e0000a",
  other: "tsk-e2e0000b",
  review: "tsk-e2e0000c",
} as const;

/** Text that must stay text wherever a record shows it. */
export const EVIL = `<img src=x onerror="window.__pwned=1">"'<script>window.__pwned=1</script>`;

/** One attack per line, so that a failure can be traced to it. */
export const HOSTILE_BODY = [
  "## Hostile corpus",
  "<script>window.__pwned = 1; alert(1)</script>",
  '<img src="https://evil.example/pixel.png" onerror="window.__pwned=1">',
  '<svg onload="window.__pwned=1"><script>window.__pwned=1</script></svg>',
  '<iframe src="https://evil.example/frame"></iframe>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/refresh">',
  "<style>body { display: none }</style>",
  '<a href="javascript:window.__pwned=1">raw anchor</a>',
  '<form action="https://evil.example/steal" method="post"><input name="x"><button>Send</button></form>',
  '<base href="https://evil.example/">',
  "[js link](javascript:window.__pwned=1)",
  "[js link upper](JaVaScRiPt:window.__pwned=1)",
  "[js link entity](&#106;avascript:window.__pwned=1)",
  "[js link tab](jav&#x09;ascript:window.__pwned=1)",
  "[data link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[vbscript link](vbscript:msgbox)",
  "[file link](file:///etc/passwd)",
  "[protocol relative](//evil.example/x)",
  "[relative](../../../etc/passwd)",
  "[credentials](https://user:pw@evil.example/)",
  "[reference style][bad]",
  "",
  "[bad]: javascript:window.__pwned=1",
  "",
  "<javascript:window.__pwned=1>",
  "![remote image](https://evil.example/image.png)",
  "![data image](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+)",
  '![bad image](javascript:window.__pwned=1 "title")',
  '[quote break](https://ok.example/"onmouseover="window.__pwned=1)',
  '[titled](https://ok.example/page "x\\" onclick=\\"window.__pwned=1")',
  '```"><script>window.__pwned=1</script>',
  "<script>window.__pwned=1</script>",
  "```",
  "| <img src=x onerror=window.__pwned=1> | b |",
  "| --- | --- |",
  "| `<script>` | [x](javascript:window.__pwned=1) |",
  "",
  "Right-to-left ‮gnp.exe override.",
].join("\n");

const LONG_WORD = "averylongunbrokenidentifier".repeat(8);
const RICH_BODY = `# Rich text

A paragraph with *emphasis*, **strong**, ~~struck~~, \`inline code\`, an
[external link](https://example.com/docs), a [mail link](mailto:team@example.com),
a reference [[dec-1wwcakek]] and a bare dec-094vmt9t. ${LONG_WORD}

## Wide table

| Service | Owner | Region | Retention | Schedule | Last checked | Notes about the row |
| --- | --- | --- | --- | --- | --- | --- |
| ledger-api-production-primary | platform-team | ap-southeast-3 | 400 days | 0 */6 * * * | 2026-10-01 | ${LONG_WORD} |

## Long code

\`\`\`bash
aimem search "a very long query that does not wrap" --type decision --status accepted --role dev --limit 50 --json --explain
${Array.from({ length: 40 }, (_, i) => `echo line-${i}`).join("\n")}
\`\`\`

### Lists

3. third
4. fourth

> A quote.

---

#### Deeper heading
`;

interface Spec {
  dir: string;
  id: string;
  type: string;
  title: string;
  status: string;
  trust?: string;
  roles?: string[];
  summary?: string;
  extra?: Record<string, unknown>;
  body?: string;
  slug?: string;
}

/** Front matter as JSON values, which are also YAML, so no value can break out of its line. */
export function writeRecord(root: string, r: Spec): void {
  const fm: Record<string, unknown> = {
    aimem: 1,
    id: r.id,
    type: r.type,
    title: r.title,
    summary: r.summary ?? `Summary of ${r.title}`.slice(0, 200),
    status: r.status,
    trust: r.trust ?? "agent",
    roles: r.roles ?? ["all"],
    author: "agent:e2e",
    created: "2026-10-10T09:00:00Z",
    updated: "2026-10-10T09:00:00Z",
    ...(r.trust === "verified" ? { verified: "2026-10-10" } : {}),
    ...r.extra,
  };
  const head = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const file = join(root, ".aimem", r.dir, `${r.id}-${r.slug ?? "e2e"}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${head}\n---\n\n${r.body ?? "Body text."}\n`);
}

const source = (system: string, url: string, more: Record<string, unknown> = {}) => ({
  managed_by: "external",
  source: {
    system,
    id: `made-up-${system}-${url}`,
    url,
    version: 1,
    content_sha: "0000",
    synced_at: "2026-10-10T09:00:00Z",
    imported_by: "human:e2e",
    state: "ok",
    ...more,
  },
});

const temporary = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

/** `medium` plus one record for each hard case, and one file that cannot be read, so the notice shows. */
export function fullNotebook(): string {
  const dir = temporary("aimem-e2e-");
  cpSync(join(FIXTURES, "medium"), dir, { recursive: true });
  const add = (r: Spec) => writeRecord(dir, r);
  add({
    dir: "memory",
    id: IDS.hostile,
    type: "memory",
    status: "active",
    title: `zzhostile ${EVIL}`,
    summary: `zzhostile summary ${EVIL}`,
    roles: ["all"],
    extra: { tags: [EVIL], paths: [EVIL], evidence: [EVIL] },
    body: HOSTILE_BODY,
  });
  add({
    dir: "memory",
    id: IDS.rich,
    type: "memory",
    status: "active",
    trust: "verified",
    title: "zzrich formatted text",
    body: RICH_BODY,
  });
  add({
    dir: "decisions",
    id: IDS.doc,
    type: "decision",
    status: "accepted",
    title: "Imported decision from a document",
    extra: source("google-doc", "https://docs.google.com/document/d/made-up/edit", { state: "missing" }),
  });
  add({
    dir: "tasks",
    id: IDS.sheet,
    type: "task",
    status: "review",
    title: "Imported task from a sheet",
    trust: "inferred",
    roles: ["qa"],
    extra: {
      priority: "p0",
      due: "2026-12-01",
      assignee: "e2e",
      blocked_by: ["tsk-e2e0000c"],
      ...source("google-sheet", "https://docs.google.com/spreadsheets/d/made-up/edit#gid=0", { row: 12 }),
    },
  });
  add({
    dir: "tests",
    id: IDS.upload,
    type: "testcase",
    status: "ready",
    title: "Imported test case from a file",
    extra: source("upload", "tests.csv", { row: "key:TC-1" }),
  });
  add({
    dir: "memory",
    id: IDS.badUrl,
    type: "memory",
    status: "active",
    title: "Imported note with an unsafe address",
    extra: source("google-doc", "javascript:window.__pwned=1"),
  });
  add({
    dir: "memory",
    id: IDS.expired,
    type: "memory",
    status: "active",
    title: "Old note that expired",
    extra: { expires: "2020-01-01" },
  });
  for (const slug of ["first", "second"])
    add({
      dir: "memory",
      id: IDS.shared,
      type: "memory",
      status: "active",
      title: `Two files share one id, ${slug}`,
      body: "## Same heading\n\nText.",
      slug,
    });
  add({
    dir: "memory",
    id: IDS.moved,
    type: "memory",
    status: "superseded",
    title: "Moved note",
    extra: { moved_to: "repo:elsewhere" },
  });
  add({
    dir: "memory",
    id: IDS.huge,
    type: "memory",
    status: "active",
    title: "Note too long to format",
    body: `${"word ".repeat(30)}\n`.repeat(1500),
  });
  add({
    dir: "tasks",
    id: IDS.other,
    type: "task",
    status: "waiting",
    title: "Task with a status outside the schema",
  });
  add({
    dir: "tasks",
    id: IDS.review,
    type: "task",
    status: "review",
    trust: "verified",
    title: "Task waiting for review",
    roles: ["qa", "dev"],
    extra: { priority: "p1" },
  });
  // Enough matches for a second page of search results and of one list.
  for (let i = 0; i < 28; i++)
    add({
      dir: "tasks",
      id: `tsk-e2f000${String(i).padStart(2, "0")}`,
      type: "task",
      status: "open",
      title: `zzpaged task ${i}`,
    });
  writeFileSync(join(dir, ".aimem/memory/mem-broken00-broken.md"), "---\n: [ not yaml\n---\n");
  return dir;
}

/** A notebook with no records, for the empty states. */
export function emptyNotebook(): string {
  const dir = temporary("aimem-e2e-empty-");
  mkdirSync(join(dir, ".aimem"));
  writeFileSync(
    join(dir, ".aimem/project.yaml"),
    `aimem: 1\nproject: ${PROJECT}\nname: Empty notebook\nmode: solo\nsync: none\nroles: [dev, pm, qa]\n`,
  );
  return dir;
}

export const remove = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 });

/** Every file and folder below `dir` with size, time and content hash: equal before and after means untouched. */
export function treeHash(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((f) => {
      const s = lstatSync(join(dir, f));
      return s.isFile()
        ? `${f} ${s.mtimeMs} ${s.mode} ${createHash("sha256")
            .update(readFileSync(join(dir, f)))
            .digest("hex")}`
        : `${f}/ ${s.mode}`;
    });
}

export interface Served {
  /** Without a slash at the end. */
  origin: string;
  stop(): Promise<void>;
}

/** `aimem serve web --port 0` of the built CLI, as a person starts it. */
export function serve(dir: string): Promise<Served> {
  const home = temporary("aimem-e2e-home-");
  const child = spawn(process.execPath, [BIN, "serve", "web", "--port", "0"], {
    cwd: dir,
    env: { ...process.env, AIMEM_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  const stop = async () => {
    child.kill("SIGTERM");
    await closed;
    remove(home);
  };
  return new Promise((done, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`viewer did not start: ${out}`)), 20_000);
    const read = (d: Buffer) => {
      out += d.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+/.exec(out);
      if (!m) return;
      clearTimeout(timer);
      done({ origin: m[0], stop });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("close", (code) => fail(new Error(`viewer exited with ${code}: ${out}`)));
  });
}

/** The ids that `aimem list <type> --status <status>` prints, sorted. */
export function listed(dir: string, type: string, status: string): string[] {
  const out = execFileSync(process.execPath, [BIN, "list", type, "--status", status, "--json"], {
    cwd: dir,
    encoding: "utf8",
  });
  const answer = JSON.parse(out) as { data: { records: { ref: string }[] } };
  return answer.data.records.map((r) => r.ref).sort();
}
