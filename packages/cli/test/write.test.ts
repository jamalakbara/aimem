import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-write-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const agent = { env: { AIMEM_AUTHOR: "agent:claude-code" } };
const human = { env: { AIMEM_AUTHOR: "human:akbar" } };
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const run = (args: string[], deps = agent) => cli([...args, "--dir", dir], deps);

const REMEMBER = [
  "remember",
  "--title",
  "Bank exports use semicolons",
  "--summary",
  "CSV exports from the bank use ';' as separator.",
  "--kind",
  "gotcha",
];

describe("add", () => {
  it("creates a record and matches the --json contract", async () => {
    const r = await run([
      ...REMEMBER,
      "--roles",
      "dev,analyst",
      "--tags",
      "bank,csv",
      "--paths",
      "src/import/**",
      "--body",
      "Seen in the September export.",
      "--json",
    ]);
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/add.json",
    );
    const text = read(r.json.data.file);
    expect(text).toContain("roles: [dev, analyst]\n");
    expect(text).toContain("paths: [src/import/**]\n");
    expect(text).toContain("kind: gotcha\n");
  });

  it("reads the body from stdin with --body -", async () => {
    const r = await cli([...REMEMBER, "--body", "-", "--json", "--dir", dir], {
      ...agent,
      stdin: async () => "From stdin.\n",
    });
    expect(read(r.json.data.file)).toMatch(/\n\nFrom stdin\.\n$/);
  });

  it("reads the body from --body-file", async () => {
    writeFileSync(join(dir, "body.md"), "Body from a file.\n");
    const r = await run([...REMEMBER, "--body-file", join(dir, "body.md"), "--json"]);
    expect(r.code).toBe(0);
    expect(read(r.json.data.file)).toMatch(/\n\nBody from a file\.\n$/);
    const both = await run([...REMEMBER, "--body", "x", "--body-file", join(dir, "body.md"), "--json"]);
    expect(both.json.error.code).toBe("USAGE");
  });

  it("without a body: exit 2, template shown, nothing written", async () => {
    const before = readdirSync(join(dir, ".aimem/memory"));
    const r = await run([...REMEMBER, "--json"]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("INVALID_RECORD");
    expect(r.json.error.details.template).toMatch(/^TODO/);
    expect(readdirSync(join(dir, ".aimem/memory"))).toEqual(before);
    const human = await run([...REMEMBER]);
    expect(human.stderr).toContain("TODO");
  });

  it("likely duplicate: exit 3 naming the existing record; --force adds anyway", async () => {
    const dup = [
      "remember",
      "--title",
      "Payment provider sends amounts as strings",
      "--summary",
      "Amounts come as strings.",
      "--body",
      "x",
    ];
    const r = await run([...dup, "--json"]);
    expect(r.code).toBe(3);
    expect(r.json.error).toMatchObject({ code: "DUPLICATE_LIKELY", details: { ref: "mem-5e6f7g8h" } });
    expect((await run([...dup, "--force", "--json"])).code).toBe(0);
  });

  it("decide/incident/runbook shortcuts pick the type; decisions start proposed", async () => {
    const d = await run([
      "decide",
      "--title",
      "Nightly reconciliation",
      "--summary",
      "Reconcile every night at 02:00 UTC.",
      "--body",
      "b",
      "--json",
    ]);
    expect(d.json.data).toMatchObject({ type: "decision", status: "proposed" });
    const i = await run([
      "incident",
      "--title",
      "Backfill stalled",
      "--summary",
      "Lock timeout halted the backfill.",
      "--body",
      "b",
      "--json",
    ]);
    expect(i.json.data.type).toBe("incident");
    const rb = await run([
      "runbook",
      "--title",
      "Rerun the backfill",
      "--summary",
      "How to resume a stalled backfill safely.",
      "--body",
      "b",
      "--json",
    ]);
    expect(rb.json.data.type).toBe("runbook");
  });

  it("add <type> with --priority/--assignee and repeated --link", async () => {
    const r = await run([
      "add",
      "task",
      "--title",
      "Drop the float column",
      "--summary",
      "Remove amount_float after the backfill check.",
      "--priority",
      "p1",
      "--assignee",
      "dana",
      "--link",
      "dec-1a2b3c4d",
      "--link",
      "tsk-3c4d5e6f",
      "--body",
      "## Goal\nx",
      "--json",
    ]);
    const text = read(r.json.data.file);
    expect(text).toContain("priority: p1\n");
    expect(text).toContain("links: [dec-1a2b3c4d, tsk-3c4d5e6f]\n");
  });

  it("no author: USAGE with a hint", async () => {
    const r = await cli([...REMEMBER, "--body", "b", "--json", "--dir", dir], { env: {} });
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("USAGE");
    expect(r.json.error.message).toMatch(/AIMEM_AUTHOR/);
  });

  it("--author overrides the environment", async () => {
    const r = await run([...REMEMBER, "--body", "b", "--author", "human:akbar", "--json"]);
    expect(read(r.json.data.file)).toContain("trust: verified\n");
  });
});

describe("update, supersede, verify", () => {
  it("update --set (repeatable) matches the contract", async () => {
    const r = await run([
      "update",
      "tsk-3c4d5e6f",
      "--set",
      "status=review",
      "--set",
      "tags=money,migration,review",
      "--json",
    ]);
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/update.json",
    );
  });

  it("update rejects a malformed --set", async () => {
    const r = await run(["update", "tsk-3c4d5e6f", "--set", "status", "--json"]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("USAGE");
  });

  it("handoff body needs --force (PERMISSION_DENIED otherwise)", async () => {
    const r = await run(["update", "hnd-7g8h9j0k", "--body", "rewrite", "--json"]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("PERMISSION_DENIED");
  });

  it("supersede matches the contract and validate stays clean", async () => {
    const add = await run([
      "remember",
      "--title",
      "Amounts arrive as decimal strings",
      "--summary",
      "Parse provider decimal strings with the money helper.",
      "--body",
      "b",
      "--json",
    ]);
    const r = await run(["supersede", "mem-5e6f7g8h", "--by", add.json.data.ref, "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ old: "mem-5e6f7g8h", new: add.json.data.ref });
    expect((await run(["validate", "--strict"])).code).toBe(0);
  });

  it("verify: agents refused, humans allowed", async () => {
    const a = await run(["verify", "mem-6f7g8h9j", "--json"]);
    expect(a.code).toBe(2);
    expect(a.json.error.code).toBe("PERMISSION_DENIED");
    const h = await run(["verify", "mem-6f7g8h9j", "tsk-4d5e6f7g", "--json"], human);
    expect(h.code).toBe(0);
    await expect(`${JSON.stringify(h.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/verify.json",
    );
  });

  it("round trip: add → show → update → verify → validate clean", async () => {
    const add = await run([
      "remember",
      "--title",
      "Exports are UTF-16",
      "--summary",
      "Bank exports arrive as UTF-16 with a BOM.",
      "--body",
      "Seen once.",
      "--json",
    ]);
    const ref = add.json.data.ref;
    expect((await run(["show", ref, "--json"])).json.data.frontmatter.title).toBe("Exports are UTF-16");
    expect((await run(["update", ref, "--set", "kind=gotcha", "--json"])).code).toBe(0);
    expect((await run(["verify", ref, "--json"], human)).code).toBe(0);
    const v = await run(["validate", "--strict", "--json"]);
    expect(v.code).toBe(0);
    expect(read(".aimem/INDEX.md")).toContain("memory: 3");
  });
});
