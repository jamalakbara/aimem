import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom, nodeFs } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decisionDoc,
  EMAIL,
  FOLDER,
  fakeGoogle,
  keyFile,
  PRIVATE_KEY,
  TOKEN,
  taskSheet,
} from "../../core/test/support/google.js";
import { type CliResult, cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
let secrets: string;
let key: string;
const outputs: string[] = [];
const human = { AIMEM_AUTHOR: "human:dana" };
const agent = { AIMEM_AUTHOR: "agent:claude-code" };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-google-"));
  secrets = mkdtempSync(join(tmpdir(), "aimem-google-key-"));
  key = join(secrets, "key.json");
  writeFileSync(key, keyFile());
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  outputs.length = 0;
  expect((await run(["sources", "add", "google", "--folder", FOLDER])).code).toBe(0);
});
afterEach(() => {
  // QA plan 14: whatever a test did, nothing it printed or wrote may carry a credential.
  const pem = PRIVATE_KEY.split("\n").filter((l) => l && !l.startsWith("-----"));
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
  for (const text of [...outputs, ...files(join(dir, ".aimem")).map((f) => readFileSync(f, "utf8"))])
    for (const secret of [TOKEN, ...pem, "eyJhbGciOiJSUzI1NiI"]) expect(text.includes(secret)).toBe(false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(secrets, { recursive: true, force: true });
});

async function run(args: string[], deps: Record<string, unknown> = {}): Promise<CliResult> {
  const { env, ...rest } = deps as { env?: Record<string, string> };
  const r = await cli([...args, "--json", "--dir", dir], {
    env: { ...human, GOOGLE_APPLICATION_CREDENTIALS: key, ...env },
    random: cryptoRandom,
    clock: { now: () => new Date("2026-11-23T10:00:00Z") },
    sleep: async () => undefined,
    ...rest,
  });
  outputs.push(r.stdout, r.stderr);
  return r;
}
const sync = (g: ReturnType<typeof fakeGoogle>, args: string[] = [], deps: Record<string, unknown> = {}) =>
  run(["sources", "sync", ...args], { fetch: g.fetch, ...deps });
const owned = () =>
  ["decisions", "tasks", "memory"].flatMap((d) => {
    const p = join(dir, ".aimem", d);
    return existsSync(p)
      ? readdirSync(p)
          .map((f) => readFileSync(join(p, f), "utf8"))
          .filter((t) => t.includes("system: google-"))
      : [];
  });

describe("aimem sources sync: Google (M4b.4)", () => {
  it("imports a Doc and a 20-row Sheet, then skips or reports them unchanged", async () => {
    const g = fakeGoogle([decisionDoc(), taskSheet()]);
    const a = await sync(g);
    expect(a.code, a.stderr).toBe(0);
    expect(a.json.data).toMatchObject({ created: 21, updated: 0, unchanged: 0, missing: 0, errors: [] });
    expect(a.json.warnings).toContain("Imported content is visible to everyone who can read this repository");
    expect(a.json.warnings).toContain("Backlog: hidden tab 'Private' was skipped");
    expect(owned()).toHaveLength(21);
    const dec = owned().find((t) => t.includes("type: decision")) ?? "";
    expect(dec).toMatch(/title: Store parcel events for 90 days\n/);
    expect(dec).toMatch(/status: accepted/);
    expect(dec).toMatch(/system: google-doc/);
    expect(dec).not.toMatch(/base64|image1/);
    expect(owned().find((t) => t.includes("type: task"))).toMatch(/due: 2026-12-15/);
    const before = g.state.requests.length;
    const b = await sync(g);
    expect(b.json.data).toMatchObject({ created: 0, updated: 0, unchanged: 21 });
    expect(g.state.requests.slice(before).some((r) => r.url.pathname.endsWith("/export"))).toBe(false);
    expect((await run(["validate", "--strict"])).code).toBe(0);
  });

  it("updates a changed Doc, and drops its verification in team mode", async () => {
    const y = join(dir, ".aimem/project.yaml");
    writeFileSync(y, readFileSync(y, "utf8").replace("mode: solo", "mode: team"));
    const doc = decisionDoc();
    const g = fakeGoogle([doc]);
    const ref = (await sync(g)).json.data.records[0].ref;
    expect((await run(["verify", ref], { env: { AIMEM_AUTHOR: "human:rina" } })).code).toBe(0);
    doc.modifiedTime = "2026-11-22T10:00:00.000Z";
    doc.markdown = doc.markdown?.replace("Keep 90 days.", "Keep 30 days.");
    const r = await sync(g);
    expect(r.json.data).toMatchObject({ updated: 1 });
    expect(r.json.warnings.join("\n")).toMatch(/was verified, but its source changed/);
    expect(owned()[0]).toMatch(/trust: agent/);
  });

  it("marks removed files and rows missing, keeps their content, and revives them", async () => {
    const doc = decisionDoc();
    const sheet = taskSheet();
    const g = fakeGoogle([doc, sheet]);
    await sync(g);
    g.state.files = [sheet];
    sheet.tabs?.[0]?.values.pop();
    const r = await sync(g);
    expect(r.json.data).toMatchObject({ missing: 2 });
    expect(owned()).toHaveLength(21);
    expect(owned().filter((t) => t.includes("state: missing"))).toHaveLength(2);
    g.state.files = [doc, sheet];
    expect((await sync(g)).json.data).toMatchObject({ updated: 1, missing: 0 });
    expect(owned().filter((t) => t.includes("state: missing"))).toHaveLength(1);
  });

  it("does not mark rows missing in a tab that has row errors", async () => {
    const sheet = taskSheet();
    const g = fakeGoogle([sheet]);
    await sync(g);
    (sheet.tabs?.[0]?.values[3] as unknown[])[2] = "nonsense";
    const r = await sync(g);
    expect(r.json.data.missing).toBe(0);
    expect(r.json.data.errors).toHaveLength(1);
    expect(r.json.data.errors[0].reason).toMatch(/status 'nonsense'/);
    expect((await sync(g, ["--strict"])).code).toBe(1);
  });

  it("a sync killed while writing ends in the same state when run again (QA 18)", async () => {
    const files = () => [decisionDoc(), taskSheet()];
    let writes = 0;
    const dying = {
      ...nodeFs,
      rename: async (a: string, b: string) => {
        if (++writes > 8) throw new Error("killed");
        return nodeFs.rename(a, b);
      },
    };
    const broken = await sync(fakeGoogle(files()), [], { fs: dying });
    expect(broken.code).not.toBe(0);
    expect(owned().length).toBeGreaterThan(0);
    expect(owned().length).toBeLessThan(21);
    expect((await sync(fakeGoogle(files()))).code).toBe(0);
    const resumed = owned().sort();
    const clean = mkdtempSync(join(tmpdir(), "aimem-google-clean-"));
    const keep = dir;
    cpSync(join(FIXTURES, "tiny"), clean, { recursive: true });
    dir = clean;
    await run(["sources", "add", "google", "--folder", FOLDER]);
    await sync(fakeGoogle(files()));
    expect(resumed).toEqual(owned().sort());
    rmSync(clean, { recursive: true, force: true });
    dir = keep;
  });

  it("--dry-run reports what would be imported and writes nothing", async () => {
    const r = await sync(fakeGoogle([decisionDoc(), taskSheet()]), ["--dry-run"]);
    expect(r.json.data).toMatchObject({ dryRun: true, records: 21 });
    expect(owned()).toEqual([]);
  });

  it("an agent's sync is one commit and trust agent", async () => {
    const git = fakeGit(undefined, "feature/sync");
    const r = await sync(fakeGoogle([decisionDoc(), taskSheet()]), [], { env: agent, git });
    expect(r.json.data.git).toBe("committed");
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(owned().every((t) => t.includes("trust: agent"))).toBe(true);
  });
});

describe("credentials and scopes (QA 14, 15)", () => {
  it("signs a valid JWT for read-only scopes and only ever talks to Google", async () => {
    const g = fakeGoogle([decisionDoc(), taskSheet()]);
    await sync(g);
    expect(g.state.jwtOk).toBe(true);
    expect(g.state.scopes).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ]);
    expect([...new Set(g.state.requests.map((r) => r.url.host))].sort()).toEqual([
      "oauth2.googleapis.com",
      "sheets.googleapis.com",
      "www.googleapis.com",
    ]);
    expect(g.state.requests.filter((r) => r.method !== "GET").map((r) => r.url.host)).toEqual([
      "oauth2.googleapis.com",
    ]);
  });

  it("refuses a key file inside the repository, also through a link, and a missing or broken key", async () => {
    const g = fakeGoogle([decisionDoc()]);
    const inside = join(dir, "key.json");
    writeFileSync(inside, keyFile());
    const a = await sync(g, [], { env: { GOOGLE_APPLICATION_CREDENTIALS: inside } });
    expect(a.json.error).toMatchObject({
      code: "SOURCE_AUTH",
      message: expect.stringMatching(/inside the repository/),
    });
    rmSync(inside);
    if (process.platform !== "win32") {
      mkdirSync(join(dir, "cfg"));
      symlinkSync(key, join(dir, "cfg/key.json"));
      expect(
        (await sync(g, [], { env: { GOOGLE_APPLICATION_CREDENTIALS: join(dir, "cfg/key.json") } })).json.error
          .message,
      ).toMatch(/inside the repository/);
    }
    const none = await sync(g, [], { env: { GOOGLE_APPLICATION_CREDENTIALS: "" } });
    expect(none.json.error).toMatchObject({
      code: "SOURCE_AUTH",
      message: expect.stringMatching(/set GOOGLE_APPLICATION_CREDENTIALS/),
    });
    writeFileSync(key, keyFile().replace("BEGIN PRIVATE", "BEGIN BROKEN"));
    const bad = await sync(g);
    expect(bad.json.error.code).toBe("SOURCE_AUTH");
    expect(g.state.requests).toEqual([]);
    expect(owned()).toEqual([]);
  });

  it.each([
    [
      "a rejected token",
      (g: ReturnType<typeof fakeGoogle>) => {
        g.state.tokenStatus = 400;
      },
    ],
    [
      "a revoked grant",
      (g: ReturnType<typeof fakeGoogle>) => {
        g.state.folder.status = 403;
      },
    ],
    [
      "a folder that is gone or not shared",
      (g: ReturnType<typeof fakeGoogle>) => {
        g.state.folder.status = 404;
      },
    ],
  ])("%s is SOURCE_AUTH and changes nothing", async (_n, arrange) => {
    const g = fakeGoogle([decisionDoc()]);
    await sync(g);
    const before = owned();
    arrange(g);
    g.state.files = [];
    const r = await sync(g);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("SOURCE_AUTH");
    expect(r.json.error.message).toContain(EMAIL);
    expect(owned()).toEqual(before);
  });
});

describe("failures of the source (QA 17, 18)", () => {
  it("offline is SOURCE_UNREACHABLE, exit 4, nothing written", async () => {
    const g = fakeGoogle([decisionDoc()]);
    g.state.queue = Array.from({ length: 10 }, () => ({ throw: `getaddrinfo ENOTFOUND ${TOKEN}` }));
    const r = await sync(g);
    expect(r.code).toBe(4);
    expect(r.json.error.code).toBe("SOURCE_UNREACHABLE");
    expect(owned()).toEqual([]);
  });

  it("--offline does not contact Google", async () => {
    const g = fakeGoogle([decisionDoc()]);
    const r = await sync(g, ["--offline"]);
    expect(r.code).not.toBe(0);
    expect(g.state.requests).toEqual([]);
  });

  it("retries 429 and 5xx, honours Retry-After up to a limit, then gives up", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const ok = fakeGoogle([decisionDoc()]);
    ok.state.queue = [{ status: 429, headers: { "retry-after": "2" } }, { status: 503 }];
    expect((await sync(ok, [], { sleep })).json.data.created).toBe(1);
    expect(waits[0]).toBe(2000);
    waits.length = 0;
    const no = fakeGoogle([decisionDoc()]);
    no.state.queue = Array.from({ length: 10 }, () => ({ status: 503, headers: { "retry-after": "86400" } }));
    expect((await sync(no, [], { sleep })).json.error.code).toBe("SOURCE_UNREACHABLE");
    expect(Math.max(...waits)).toBeLessThanOrEqual(30_000);
  });

  it("one unreadable file is reported and the others still import; it is not marked missing", async () => {
    const doc = decisionDoc();
    const g = fakeGoogle([doc, taskSheet()]);
    await sync(g);
    doc.modifiedTime = "2026-11-22T00:00:00.000Z";
    doc.fail = { status: 403, reason: "exportSizeLimitExceeded" };
    const r = await sync(g);
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ unchanged: 20, missing: 0 });
    expect(r.json.data.errors).toEqual([
      { file: doc.name, reason: "Google refused to export it (exportSizeLimitExceeded)" },
    ]);
  });

  it("follows pages, stops a paging loop, and skips unsupported files", async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      decisionDoc({
        id: `1DocNumber${i}DDDDDDDDDDDDDDD`,
        name: `${"amber bridge copper dragon ember".split(" ")[i]} rule`,
        markdown: `Note number ${i} about ${"amber bridge copper dragon ember".split(" ")[i]}.`,
      }),
    );
    const g = fakeGoogle([
      ...docs,
      {
        id: "1PdfFileEEEEEEEEEEEEEEEEEEEE",
        name: "scan.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-11-20T00:00:00Z",
      },
    ]);
    g.state.pageSize = 2;
    const r = await sync(g);
    expect(r.json.data.created).toBe(5);
    expect(r.json.warnings).toContain(
      "scan.pdf: application/pdf files are not synced; download it and use aimem import",
    );
    const loop = fakeGoogle(docs);
    loop.state.loopPages = true;
    const l = await sync(loop);
    expect(l.json.error.code).toBe("SOURCE_UNREACHABLE");
    expect(l.json.error.message).toMatch(/kept returning the same page/);
  });

  it("refuses a document over the size limit and one that looks like it holds a secret", async () => {
    const k = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    const g = fakeGoogle([
      decisionDoc({
        id: "1DocHugeFFFFFFFFFFFFFFFFFFFF",
        name: "Huge",
        markdown: "x ".repeat(6 * 1024 * 1024),
      }),
      decisionDoc({ id: "1DocLeakGGGGGGGGGGGGGGGGGGGG", name: "Leak", markdown: `Key ${k}` }),
    ]);
    const r = await sync(g);
    expect(r.json.data.created).toBe(0);
    expect(
      r.json.data.errors.map((e: { file: string; reason: string }) => `${e.file}: ${e.reason}`).join("\n"),
    ).toMatch(/Huge: is larger than 10 MB[\s\S]*Leak: SECRET_DETECTED/);
    expect(r.stdout).not.toContain(k);
  });
});

describe("aimem sources add / list / remove", () => {
  it("accepts ids and Drive links, refuses anything else, and is for people only", async () => {
    const link = await run([
      "sources",
      "add",
      "google",
      "--file",
      "https://docs.google.com/document/d/1DocDecisionBBBBBBBBBBBBBBBB/edit?usp=sharing",
    ]);
    expect(link.code).toBe(0);
    for (const bad of ["x' or name contains 'a", "../etc", "short"])
      expect((await run(["sources", "add", "google", "--folder", bad])).code).toBe(2);
    const a = await run(["sources", "add", "google", "--folder", FOLDER], { env: agent });
    expect(a.json.error.code).toBe("PERMISSION_DENIED");
    const list = await run(["sources", "list"]);
    expect(list.json.data.sources).toEqual([
      { kind: "google", folder: FOLDER, files: ["1DocDecisionBBBBBBBBBBBBBBBB"], records: 0 },
    ]);
    expect(readFileSync(join(dir, ".aimem/project.yaml"), "utf8")).toMatch(/inbox_folder_id: 1Folder/);
  });

  it("syncs a single added file outside the folder, and remove keeps its records", async () => {
    await run(["sources", "remove", "google"]);
    await run(["sources", "add", "google", "--file", "1DocDecisionBBBBBBBBBBBBBBBB"]);
    const g = fakeGoogle([decisionDoc(), taskSheet()]);
    const r = await sync(g);
    expect(r.json.data.created).toBe(1);
    expect(g.state.requests.some((q) => q.url.searchParams.has("q"))).toBe(false);
    expect((await run(["sources", "remove", "google"])).code).toBe(0);
    expect(owned()).toHaveLength(1);
    expect((await sync(g)).json.error).toMatchObject({
      code: "USAGE",
      message: expect.stringMatching(/no source is configured/),
    });
  });
});

describe("QA #106 review", () => {
  const note = (name: string, n: number) =>
    decisionDoc({
      id: `1DocSeries${String(n).padStart(4, "0")}HHHHHHHHHHHH`,
      name,
      markdown: `Notes for ${name}.`,
    });

  it("a new Doc with a name like earlier ones is imported (recurring notes and reports)", async () => {
    const days = ["Monday", "Tuesday", "Wednesday"].map((d, i) => note(`Meeting notes ${d}`, i));
    const g = fakeGoogle(days);
    expect((await sync(g)).json.data).toMatchObject({ created: 3, errors: [] });
    g.state.files = [...days, note("Meeting notes Thursday", 3)];
    expect((await sync(g)).json.data).toMatchObject({ created: 1, unchanged: 3, errors: [] });
  });

  it("a killed sync of look-alike Docs ends like an uninterrupted one", async () => {
    const files = () => Array.from({ length: 60 }, (_, i) => note(`Doc number ${i}`, i));
    let writes = 0;
    const dying = {
      ...nodeFs,
      rename: async (a: string, b: string) => {
        if (++writes > 10) throw new Error("killed");
        return nodeFs.rename(a, b);
      },
    };
    await sync(fakeGoogle(files()), [], { fs: dying });
    expect(owned().length).toBeLessThan(60);
    expect((await sync(fakeGoogle(files()))).json.data.errors).toEqual([]);
    const resumed = owned().sort();
    const keep = dir;
    dir = mkdtempSync(join(tmpdir(), "aimem-google-clean-"));
    cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
    await run(["sources", "add", "google", "--folder", FOLDER]);
    await sync(fakeGoogle(files()));
    const clean = owned().sort();
    rmSync(dir, { recursive: true, force: true });
    dir = keep;
    expect(resumed).toEqual(clean);
    expect(resumed).toHaveLength(60);
  });

  it("still holds a Doc that looks like a hand-written record, until --force", async () => {
    await run(["remember", "--title", "Meeting notes Monday", "--summary", "By hand.", "--body", "Mine."]);
    const g = fakeGoogle([note("Meeting notes Monday", 1)]);
    const r = await sync(g);
    expect(r.json.data.created).toBe(0);
    expect(r.json.data.errors[0].reason).toMatch(/DUPLICATE_LIKELY/);
    expect((await sync(g, ["--force"])).json.data.created).toBe(1);
  });

  it("reads only a small regular file as the key", async () => {
    const g = fakeGoogle([decisionDoc()]);
    writeFileSync(key, "x".repeat(70 * 1024));
    expect((await sync(g)).json.error).toMatchObject({
      code: "SOURCE_AUTH",
      message: expect.stringMatching(/not a small regular file/),
    });
    if (process.platform !== "win32")
      expect(
        (await sync(g, [], { env: { GOOGLE_APPLICATION_CREDENTIALS: "/dev/zero" } })).json.error.message,
      ).toMatch(/not a small regular file/);
  });

  it("removes bidi overrides and invisible tag characters from names, and front matter from the body", async () => {
    const g = fakeGoogle([note("Invoice \u202Efdp.exe\u{E0041}", 1)]);
    (g.state.files[0] as { markdown: string }).markdown = "---\nid: dec-evilforge\n---\n\nReal text.";
    const r = await sync(g);
    expect(r.json.data.created).toBe(1);
    expect(owned()[0]).toMatch(/title: Invoice fdp\.exe\n/);
    expect(owned()[0]).not.toMatch(/dec-evilforge/);
    expect(r.stdout).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/u);
  });

  it("a sync killed just before INDEX.md is repaired by the next sync", async () => {
    const files = [note("First", 1), note("Second", 2)];
    const dying = {
      ...nodeFs,
      rename: async (a: string, b: string) => {
        if (b.endsWith("INDEX.md")) throw new Error("killed");
        return nodeFs.rename(a, b);
      },
    };
    await sync(fakeGoogle(files), [], { fs: dying });
    expect(owned()).toHaveLength(2);
    const index = join(dir, ".aimem/INDEX.md");
    expect(existsSync(index)).toBe(false);
    expect((await sync(fakeGoogle(files))).json.data).toMatchObject({ created: 0, unchanged: 2 });
    expect(existsSync(index)).toBe(true);
  });

  it("keeps text between two horizontal rules: that is not front matter", async () => {
    const g = fakeGoogle([note("Ruled", 1)]);
    (g.state.files[0] as { markdown: string }).markdown =
      "---\n\nAgreed with legal: keep logs.\n\n---\n\nSecond part.";
    const r = await sync(g);
    expect(owned()[0]).toMatch(/keep logs/);
    expect(owned()[0]).toMatch(/Second part/);
    expect(r.json.warnings.join()).not.toMatch(/front matter/);
  });

  it("says that subfolders are not read", async () => {
    const g = fakeGoogle([
      {
        id: "1SubFolderIIIIIIIIIIIIIIIIII",
        name: "Archive",
        mimeType: "application/vnd.google-apps.folder",
        modifiedTime: "2026-11-20T00:00:00Z",
      },
    ]);
    expect((await sync(g)).json.warnings).toContain("Archive: subfolders are not synced");
  });
});

describe("aimem sources status", () => {
  const offline = { fetch: () => Promise.reject(new Error("status must not use the network")) };
  const status = (deps: Record<string, unknown> = {}) => run(["sources", "status"], { ...offline, ...deps });

  it("reports the selection, records and missing ones, without the network or any write", async () => {
    const doc = decisionDoc();
    const g = fakeGoogle([doc, taskSheet()]);
    const ref = (await sync(g)).json.data.records.find((r: { ref: string }) => r.ref.startsWith("dec-")).ref;
    g.state.files = [
      taskSheet(),
      decisionDoc({ id: "1DocLaterZZZZZZZZZZZZZZZZZZZ", name: "Rename the courier queue" }),
    ];
    await sync(g, [], { clock: { now: () => new Date("2026-11-24T08:00:00Z") } });
    const tree = () =>
      readdirSync(join(dir, ".aimem"), { recursive: true })
        .map(String)
        .sort()
        .filter((f) => statSync(join(dir, ".aimem", f)).isFile() && !f.startsWith(".cache"))
        .map((f) => [f, readFileSync(join(dir, ".aimem", f), "utf8")]);
    const before = tree();
    for (const env of [human, agent]) {
      const r = await status({ env });
      expect(r.code, r.stderr).toBe(0);
      expect(r.json.data.sources).toEqual([
        {
          kind: "google",
          configured: true,
          folder: FOLDER,
          files: [],
          credentials: "ready",
          documents: 2,
          rows: 20,
          missing: [{ ref, title: "Store parcel events for 90 days" }],
          last_change: "2026-11-24T08:00:00.000Z",
        },
      ]);
    }
    expect(tree()).toEqual(before);
    const text = await cli(["sources", "status", "--dir", dir], {
      env: { ...human, GOOGLE_APPLICATION_CREDENTIALS: key },
      random: cryptoRandom,
    });
    expect(text.stdout).toContain(`missing  ${ref}  Store parcel events for 90 days`);
  });

  it("says why the key cannot be used, without its path or content, and still exits 0", async () => {
    const none = await status({ env: { GOOGLE_APPLICATION_CREDENTIALS: "" } });
    expect(none.code).toBe(0);
    expect(none.json.data.sources[0]).toMatchObject({
      credentials: "missing",
      documents: 0,
      last_change: null,
    });
    writeFileSync(key, `{"type":"service_account","private_key":"${TOKEN.slice(0, 4)}secret"`);
    const bad = await status();
    expect(bad.json.data.sources[0].credentials).toBe("unusable");
    expect(bad.stdout + bad.stderr).not.toMatch(/secret"/);
    expect(bad.stdout).not.toContain(key);
    cpSync(key, join(dir, "key.json"));
    const inside = await status({ env: { GOOGLE_APPLICATION_CREDENTIALS: join(dir, "key.json") } });
    expect(inside.json.warnings.join()).toMatch(/inside the repository/);
  });

  it("reports records of a removed source, an empty notebook and a broken id in project.yaml", async () => {
    await sync(fakeGoogle([decisionDoc()]));
    await run(["sources", "remove", "google"]);
    expect((await status()).json.data.sources[0]).toMatchObject({ configured: false, documents: 1 });
    rmSync(join(dir, ".aimem/decisions"), { recursive: true });
    expect((await status()).json.data.sources).toEqual([]);
    expect((await run(["sources", "add", "google", "--folder", FOLDER])).code).toBe(0);
    const y = join(dir, ".aimem/project.yaml");
    writeFileSync(y, readFileSync(y, "utf8").replace(FOLDER, '"not an id!"'));
    const r = await status();
    expect(r.json.warnings.join()).toMatch(/inbox_folder_id/);
  });

  it("names in warnings carry no invisible characters", async () => {
    const r = await sync(
      fakeGoogle([
        {
          id: "1ZeroWidthAAAAAAAAAAAAAAAAAA",
          name: "Arch\u200Bive\u2060",
          mimeType: "application/vnd.google-apps.folder",
          modifiedTime: "2026-11-20T00:00:00Z",
        },
      ]),
    );
    expect(r.json.warnings).toContain("Archive: subfolders are not synced");
  });
});
