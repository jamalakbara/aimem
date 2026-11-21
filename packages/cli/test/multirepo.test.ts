import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

const HUB_DECISION = "dec-t1a73qsk";
let root: string;
let backend: string;
let env: Record<string, string>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-multirepo-"));
  cpSync(join(FIXTURES, "multirepo"), root, { recursive: true });
  backend = join(root, "backend");
  env = { AIMEM_HOME: join(root, "cache"), AIMEM_AUTHOR: "human:dana" };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (args: string[]) => cli([...args, "--dir", backend], { env });

describe("multi-repo read commands (03 §7, M3.6a)", () => {
  it("shows a hub record by global ref and labels it", async () => {
    const r = await run(["show", `acme-shop:${HUB_DECISION}`, "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ ref: HUB_DECISION, notebook: "hub" });
    expect((await run(["show", HUB_DECISION])).stdout).toContain(
      `${HUB_DECISION} [verified] [hub] Store money`,
    );
  });

  it("says which notebook a shown file lives in", async () => {
    const out = (await run(["show", HUB_DECISION])).stdout.split("\n");
    expect(out[1]).toMatch(/^decision · proposed · hub: \.aimem\/decisions\/dec-t1a73qsk-/);
    // Local records keep the plain path.
    const local = (await run(["show", "dec-n7wmym39"])).stdout.split("\n");
    expect(local[1]).toMatch(/^decision · proposed · \.aimem\/decisions\/dec-n7wmym39-/);
  });

  it("adds a SOURCE column to list only when other notebooks contribute records", async () => {
    const lines = (await run(["list"])).stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^ID\s+TYPE\s+STATUS\s+TRUST\s+SOURCE\s+TITLE$/);
    expect(lines.find((l) => l.startsWith(HUB_DECISION))).toMatch(/\bhub\s+Store money/);
    expect(lines.find((l) => l.startsWith("dec-n7wmym39"))).toMatch(/\blocal\s+Orders live/);
    expect(lines.find((l) => l.startsWith("mem-6y3pjvja"))).toMatch(/\brepo:frontend\s+Cart page/);
    // A single-notebook project keeps the old columns.
    const tiny = await cli(["list", "--dir", join(FIXTURES, "tiny")], { env });
    expect(tiny.stdout.split("\n")[0]).toMatch(/^ID\s+TYPE\s+STATUS\s+TRUST\s+TITLE$/);
  });

  it("names unchecked sources when a ref is not found", async () => {
    const r = await run(["show", "acme-shop:dec-00000000", "--json"]);
    expect(r.code).toBe(1);
    expect(r.json.error.message).toBe("record acme-shop:dec-00000000 not found (not checked: repo:infra)");
  });

  it("searches across notebooks with a notebook label in JSON", async () => {
    const r = await run(["search", "integer cents money", "--mode", "lexical", "--json"]);
    expect(r.json.data.hits[0]).toMatchObject({ ref: HUB_DECISION, notebook: "hub" });
    expect(r.json.data.hits.some((h: { notebook?: string }) => h.notebook === "repo:frontend")).toBe(true);
  });

  it("reports sources in status and context", async () => {
    const s = await run(["status", "--json"]);
    expect(s.json.data.sources).toEqual([
      { name: "local", kind: "local", status: "ok", records: 2 },
      { name: "hub", kind: "hub", status: "ok", records: 2 },
      { name: "repo:frontend", kind: "repo", status: "ok", records: 1 },
      {
        name: "repo:infra",
        kind: "repo",
        status: "missing",
        reason: "no checkout at ../infra or the aimem cache",
      },
    ]);
    expect(s.json.warnings).toContain("mem-qmrpmxdn exists in local and repo:frontend; using local.");
    const c = await run(["context", "--task", "money in the cart"]);
    expect(c.stdout).toContain("> sources: local, hub, repo:frontend · missing: repo:infra");
    expect(c.stdout).toContain("[hub] Store money as integer cents");
  });

  it("accepts links to hub records and rejects unknown ones when every source was read", async () => {
    const body = [
      "--title",
      "Refund amounts are cents",
      "--summary",
      "Refunds reuse the hub money decision.",
      "--body",
      "Refunds are integer cents.",
    ];
    const ok = await run(["remember", ...body, "--link", `acme-shop:${HUB_DECISION}`, "--json"]);
    expect(ok.code).toBe(0);
    // infra is missing, so an unknown project-qualified ref cannot be ruled out.
    const unverifiable = await run([
      "remember",
      "--title",
      "Infra note",
      "--summary",
      "Points at infra.",
      "--body",
      "x",
      "--link",
      "acme-shop:dec-00000000",
      "--json",
    ]);
    expect(unverifiable.code).toBe(0);
    const local = await run([
      "remember",
      "--title",
      "Bad link",
      "--summary",
      "Unqualified unknown ref.",
      "--body",
      "x",
      "--link",
      "dec-00000000",
      "--json",
    ]);
    expect(local.json.error.code).toBe("INVALID_RECORD");
    cpSync(join(root, "frontend"), join(root, "infra"), { recursive: true });
    const unknown = await run([
      "remember",
      "--title",
      "Typo link",
      "--summary",
      "Unknown qualified ref.",
      "--body",
      "x",
      "--link",
      "acme-shop:dec-zzzzzzzz",
      "--json",
    ]);
    expect(unknown.json.error).toMatchObject({
      code: "INVALID_RECORD",
      message: "link target acme-shop:dec-zzzzzzzz not found",
    });
  });
});

describe("aimem move (04 §4, M3.6c)", () => {
  const MEM = "mem-qmrpmxdn";
  const DEC = "dec-n7wmym39";

  it("moves a record to the hub, leaves a pointer stub and reads the moved copy", async () => {
    const r = await run(["move", DEC, "--to", "hub", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({
      ref: DEC,
      to: "hub",
      target: { changed: expect.arrayContaining([expect.stringContaining(`${DEC}-`)]) },
    });
    const stub = await run(["show", DEC, "--json"]);
    expect(stub.json.data).toMatchObject({ ref: DEC, notebook: "hub" });
    expect(stub.json.data.frontmatter).not.toHaveProperty("moved_to");
    const raw = await cli(["list", "decision", "--json", "--dir", join(root, "shop-hub")], { env });
    expect(raw.json.data.records.map((x: { ref: string }) => x.ref)).toContain(DEC);
    const local = await cli(["validate", "--strict", "--json", "--dir", backend], { env });
    expect(local.code).toBe(0);
    const project = await cli(["validate", "--project", "--json", "--dir", backend], { env });
    expect(project.json.error.details.issues.map((i: { ref: string }) => i.ref)).toEqual([MEM]);
    const again = await run(["move", DEC, "--to", "hub", "--json"]);
    expect(again.json.error).toMatchObject({ code: "USAGE", message: `${DEC} was already moved to hub` });
  });

  it("writes a stub that says how to open the moved record, without promising a removal date", async () => {
    await run(["move", DEC, "--to", "hub"]);
    const raw = (await run(["show", DEC, "--raw"])).stdout;
    // show resolves to the hub copy; read the stub file itself.
    expect(raw).not.toContain("moved_to");
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = join(backend, ".aimem", "decisions");
    const stub = readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith(DEC)) ?? ""), "utf8");
    expect(stub).toContain(
      `Moved to hub. Open it with \`aimem show acme-shop:${DEC}\`. If this machine has no copy of hub, check it out next to this repo or in the aimem cache.`,
    );
    expect(stub).not.toContain("next release");
  });

  it("refuses unknown, missing and occupied targets", async () => {
    expect((await run(["move", DEC, "--to", "mobile", "--json"])).json.error.message).toBe(
      "unknown move target 'mobile' (configured: hub, frontend, infra)",
    );
    expect((await run(["move", DEC, "--to", "infra", "--json"])).json.error.message).toContain(
      "repo:infra is not available",
    );
    expect((await run(["move", MEM, "--to", "frontend", "--json"])).json.error).toMatchObject({
      code: "INVALID_RECORD",
      message: `repo:frontend already has a record ${MEM}`,
    });
    expect((await run(["move", "dec-t1a73qsk", "--to", "frontend", "--json"])).json.error.code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("team duplicate checks across notebooks (M3.7c)", () => {
  it("finds a similar record in a sibling notebook and still writes with --force", async () => {
    const args = [
      "remember",
      "--title",
      "Cart page shows cents divided by 100",
      "--summary",
      "The cart formats integer cents from the API.",
      "--body",
      "x",
      "--json",
    ];
    const dup = await run(args);
    expect(dup.code).toBe(3);
    expect(dup.json.error).toMatchObject({
      code: "DUPLICATE_LIKELY",
      details: { ref: "mem-6y3pjvja", notebook: "repo:frontend" },
    });
    expect(dup.json.error.message).toBe(
      'a similar memory exists in repo:frontend: mem-6y3pjvja "Cart page shows cents divided by 100". Open it with aimem show acme-shop:mem-6y3pjvja, then update or supersede it there, or pass --force to add this one anyway.',
    );
    expect((await run([...args, "--force"])).code).toBe(0);
  });
});
