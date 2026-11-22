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
