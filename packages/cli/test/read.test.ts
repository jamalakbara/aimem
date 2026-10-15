import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

const medium = join(FIXTURES, "medium");
const messy = join(FIXTURES, "messy");
const tiny = join(FIXTURES, "tiny");

describe("show", () => {
  it("prints a record for humans", async () => {
    const r = await cli(["show", "dec-mtbcq7yr", "--dir", medium]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("dec-mtbcq7yr [verified] Hybrid retrieval with local embeddings in v1");
    expect(r.stdout).toContain("## Decision");
  });

  it("--raw prints the file exactly", async () => {
    const r = await cli(["show", "dec-1a2b3c4d", "--raw", "--dir", tiny]);
    expect(r.stdout).toMatch(/^---\naimem: 1\nid: dec-1a2b3c4d\n/);
  });

  it("accepts the own-project global ref form", async () => {
    const r = await cli(["show", "acme-ledger:dec-1a2b3c4d", "--json", "--dir", tiny]);
    expect(r.json.data.ref).toBe("dec-1a2b3c4d");
  });

  it("--links includes summaries and marks unknown targets", async () => {
    const r = await cli(["show", "dec-1a2b3c4d", "--links", "--json", "--dir", tiny]);
    expect(r.json.data.links.map((l: { ref: string }) => l.ref)).toEqual(["tsk-3c4d5e6f", "mem-5e6f7g8h"]);
    const m = await cli(["show", "dec-00000011", "--links", "--json", "--dir", messy]);
    expect(m.json.data.links).toEqual([{ ref: "mem-zzzzzzzz", missing: true }]);
  });
});

describe("list", () => {
  it("lists every record with filters combined", async () => {
    const all = await cli(["list", "--json", "--dir", medium]);
    expect(all.json.data.count).toBe(127);
    const r = await cli(["list", "task", "--status", "open,blocked", "--json", "--dir", medium]);
    expect(
      r.json.data.records.every(
        (x: { type: string; status: string }) => x.type === "task" && ["open", "blocked"].includes(x.status),
      ),
    ).toBe(true);
    expect(r.json.data.count).toBe(17);
  });

  it("--stale uses the clock", async () => {
    const r = await cli(["list", "--stale", "--json", "--dir", medium]);
    expect(r.json.data.count).toBe(9);
  });

  it("prints a table for humans", async () => {
    const r = await cli(["list", "decision", "--tag", "pinned", "--dir", medium]);
    expect(r.stdout.split("\n")[0]).toMatch(/^ID\s+TYPE\s+STATUS\s+TRUST\s+TITLE$/);
    expect(r.stdout).toContain("Files in git are the source of truth");
  });

  it("rejects an unknown type", async () => {
    const r = await cli(["list", "note", "--json", "--dir", medium]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("USAGE");
  });
});

describe("search", () => {
  it("returns ranked hits", async () => {
    const r = await cli(["search", "anggaran token", "--json", "--dir", medium]);
    expect(r.json.data.mode).toBe("lexical");
    expect(r.json.data.hits[0].title).toBe("Anggaran token dihitung dengan chars/4");
  });

  it("passes filters through and warns that hybrid is not available yet", async () => {
    const r = await cli([
      "search",
      "zod",
      "--include-superseded",
      "--type",
      "decision",
      "--mode",
      "hybrid",
      "--json",
      "--dir",
      medium,
    ]);
    expect(r.json.data.hits.map((h: { title: string }) => h.title)).toContain(
      "Use Zod 3 with passthrough objects",
    );
    expect(r.json.warnings.join(" ")).toMatch(/hybrid/);
  });
});

describe("validate", () => {
  it("clean notebook exits 0", async () => {
    const r = await cli(["validate", "--json", "--dir", tiny]);
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ errors: 0, warnings: 0, issues: [] });
  });

  it("warnings only: exit 0, or 1 with --strict", async () => {
    expect((await cli(["validate", "--dir", medium])).code).toBe(0);
    const strict = await cli(["validate", "--strict", "--json", "--dir", medium]);
    expect(strict.code).toBe(1);
    expect(strict.json.ok).toBe(true);
    expect(strict.json.data.warnings).toBe(9);
  });

  it("errors: exit 2 with INVALID_RECORD and the issues in details", async () => {
    const r = await cli(["validate", "--json", "--dir", messy]);
    expect(r.code).toBe(2);
    expect(r.json.ok).toBe(false);
    expect(r.json.error.code).toBe("INVALID_RECORD");
    expect(r.json.error.details.issues.some((i: { code: string }) => i.code === "V008")).toBe(true);
    expect(r.stdout).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it("prints issues for humans", async () => {
    const r = await cli(["validate", "--dir", messy]);
    expect(r.stdout).toMatch(/error V001 \.aimem\/decisions\/dec-0000000a-unclosed-flow-sequence\.md/);
  });
});
