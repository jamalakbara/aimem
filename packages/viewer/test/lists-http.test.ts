import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORD_TYPES } from "@aimem/schema";
import { afterEach, describe, expect, it } from "vitest";
import { clean, FIXTURES, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const BIN = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
const env = { ...process.env, AIMEM_HOME: "/nonexistent-aimem-home" };
const refs = (html: string) => [...html.matchAll(/<li data-ref="([^"]+)"/g)].map((m) => m[1] ?? "");
const SECTIONS = ["decisions", "handoffs", "records"];

describe("lists over HTTP (24 §5.5)", () => {
  it("serves each list, with the security headers", async () => {
    const v = await viewer(notebook());
    const P = "/p/acme-ledger";
    for (const path of [
      ...SECTIONS.map((s) => `${P}/${s}`),
      `${P}/decisions/`,
      `${P}/decisions?status=accepted`,
      `${P}/decisions?status=nope&page=x`,
      `${P}/records?type=incident`,
      `${P}/records?type=nope`,
      `${P}/records?type=decision&status=accepted&page=2`,
    ]) {
      const r = await get(v, path);
      expect(r.status, path).toBe(200);
      expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    }
    for (const s of SECTIONS) {
      const head = await get(v, `${P}/${s}`, { method: "HEAD" });
      expect([head.status, head.body], s).toEqual([200, ""]);
    }
  });

  it("answers 404 for anything below them, a different case, and another project", async () => {
    const v = await viewer(notebook());
    for (const s of SECTIONS)
      for (const p of [
        `/p/acme-ledger/${s}/x`,
        `/p/acme-ledger/${s}/..%2fr`,
        `/p/acme-ledger/${s.toUpperCase()}`,
        `/p/other/${s}`,
      ]) {
        const r = await get(v, p);
        expect(r.status, p).toBe(404);
        expect(r.body).not.toContain('class="sections"');
      }
    expect((await get(v, "/p/acme-ledger/incidents")).status).toBe(404);
  });

  it("refuses everything but GET and HEAD", async () => {
    const v = await viewer(notebook());
    for (const s of SECTIONS)
      for (const method of ["POST", "PUT", "DELETE"])
        expect((await get(v, `/p/acme-ledger/${s}`, { method })).status).toBe(405);
  });

  it("links every list from every page of the notebook", async () => {
    const v = await viewer(notebook());
    for (const p of ["", "/search?q=float", "/tasks", "/decisions", "/handoffs", "/records", "/r/nope"]) {
      const r = await get(v, `/p/acme-ledger${p}`);
      for (const s of ["tasks", "decisions", "handoffs", "records"])
        expect(r.body, p).toContain(`href="/p/acme-ledger/${s}"`);
    }
  });
});

describe("the lists show what `aimem list` shows (24 §5.5)", () => {
  type Listed = { ref: string; type: string; status: string };
  /** `aimem list [type] --json`. One process lists every type, because a process is slow on some machines. */
  const list = (dir: string, ...args: string[]): Listed[] => {
    const r = spawnSync(process.execPath, [BIN, "list", ...args, "--json"], {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 60000,
    });
    expect(r.status, r.stderr).toBe(0);
    return (JSON.parse(r.stdout) as { data: { records: Listed[] } }).data.records;
  };
  const pages = async (v: Awaited<ReturnType<typeof viewer>>, base: string) => {
    const got: string[] = [];
    let next: string | undefined = base;
    for (let i = 0; next !== undefined && i < 200; i++) {
      const body: string = (await get(v, next)).body;
      got.push(...refs(body));
      const m: RegExpExecArray | null = /rel="next" href="([^"]+)"/.exec(body);
      next = m?.[1]?.replace(/&amp;/g, "&");
    }
    return got;
  };

  it.each(["tiny", "medium", "messy"])(
    "in %s, every type, on its own page and in Browse",
    async (name) => {
      const dir = notebook(name);
      const v = await viewer(dir);
      const project = (readFileSync(join(dir, ".aimem/project.yaml"), "utf8").match(/^project: (.+)$/m) ??
        [])[1];
      const everything = list(dir);
      for (const type of RECORD_TYPES) {
        const want = everything
          .filter((r) => r.type === type)
          .map((r) => r.ref)
          .sort();
        expect((await pages(v, `/p/${project}/records?type=${type}`)).sort(), `${name} ${type}`).toEqual(
          want,
        );
        const own: Record<string, string> = { decision: "decisions", handoff: "handoffs" };
        if (own[type])
          expect((await pages(v, `/p/${project}/${own[type]}`)).sort(), `${name} ${own[type]}`).toEqual(want);
      }
      const first = everything.find((r) => r.type === "decision")?.status;
      if (first) {
        const want = list(dir, "decision", "--status", first)
          .map((r) => r.ref)
          .sort();
        expect((await pages(v, `/p/${project}/decisions?status=${first}`)).sort()).toEqual(want);
      }
    },
    120_000,
  );

  it("in a project with a hub, the decisions of the hub as well", async () => {
    const root = mkdtempSync(join(tmpdir(), "aimem-viewer-multi-"));
    try {
      cpSync(join(FIXTURES, "multirepo"), root, { recursive: true });
      const dir = join(root, "backend");
      const v = await viewer(dir);
      const want = list(dir, "decision")
        .map((r) => r.ref)
        .sort();
      expect(want.length).toBeGreaterThan(0);
      const body = (await get(v, "/p/acme-shop/decisions")).body;
      expect(refs(body).sort()).toEqual(want);
      expect(body).toContain(">hub<");
      await v.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
  }, 120_000);
});
