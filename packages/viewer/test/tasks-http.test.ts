import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATUSES } from "@aimem/schema";
import { afterEach, describe, expect, it } from "vitest";
import { clean, FIXTURES, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const BIN = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
const env = { ...process.env, AIMEM_HOME: "/nonexistent-aimem-home" };
const refs = (html: string) => [...html.matchAll(/<li data-ref="([^"]+)"/g)].map((m) => m[1] ?? "");

describe("task board over HTTP (24 §5.4)", () => {
  it("serves the board and a status, with the security headers", async () => {
    const v = await viewer(notebook());
    const P = "/p/acme-ledger";
    for (const path of [
      `${P}/tasks`,
      `${P}/tasks/`,
      `${P}/tasks?status=review`,
      `${P}/tasks?status=nope&page=x`,
    ]) {
      const r = await get(v, path);
      expect(r.status, path).toBe(200);
      expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    }
    const head = await get(v, `${P}/tasks`, { method: "HEAD" });
    expect([head.status, head.body]).toEqual([200, ""]);
  });

  it("answers 404 for anything below it and for another project", async () => {
    const v = await viewer(notebook());
    for (const p of [
      "/p/acme-ledger/tasks/x",
      "/p/acme-ledger/tasks/..%2fr",
      "/p/acme-ledger/Tasks",
      "/p/acme-ledger/taskss",
      "/p/other/tasks",
    ]) {
      const r = await get(v, p);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain('class="sections"');
    }
  });

  it("refuses everything but GET and HEAD", async () => {
    const v = await viewer(notebook());
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const r = await get(v, "/p/acme-ledger/tasks", { method });
      expect(r.status, method).toBe(405);
    }
  });

  it("has the same HTML for a phone and a desktop, which only the style sheet tells apart", async () => {
    const v = await viewer(notebook());
    const a = await get(v, "/p/acme-ledger/tasks", {
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" },
    });
    const b = await get(v, "/p/acme-ledger/tasks", {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" },
    });
    expect(a.body).toBe(b.body);
    expect(a.body).not.toMatch(/<script(?! src="\/assets\/app\.js")/);
  });

  it("shows a change of a task on the next request", async () => {
    const dir = notebook();
    const v = await viewer(dir);
    const before = await get(v, "/p/acme-ledger/tasks?status=review");
    const { writeFileSync } = await import("node:fs");
    const tasks = join(dir, ".aimem/tasks");
    const f = readdirSync(tasks).sort()[0] ?? "";
    const text = readFileSync(join(tasks, f), "utf8");
    writeFileSync(join(tasks, f), text.replace(/^status: .*$/m, "status: review"));
    const after = await get(v, "/p/acme-ledger/tasks?status=review");
    expect(refs(after.body).length).toBeGreaterThan(refs(before.body).length);
  });

  it("changes nothing in the project, whatever is requested", async () => {
    const dir = notebook();
    const tree = (d: string): string[] =>
      readdirSync(d, { recursive: true })
        .map(String)
        .sort()
        .map((f) => {
          const p = join(d, f);
          const s = statSync(p);
          return s.isFile()
            ? `${f} ${s.mtimeMs} ${createHash("sha256").update(readFileSync(p)).digest("hex")}`
            : `${f}/`;
        });
    const before = tree(dir);
    const v = await viewer(dir);
    for (const p of [
      "/p/acme-ledger/tasks",
      "/p/acme-ledger/tasks?status=review&page=2",
      "/p/acme-ledger/tasks?status=x",
    ])
      for (const method of ["GET", "HEAD", "POST", "DELETE"]) await get(v, p, { method });
    expect(tree(dir)).toEqual(before);
  });
});

describe("the board shows the tasks that `aimem list` shows (24 §5.4)", () => {
  const list = (dir: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, "list", "task", ...args, "--json"], {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(r.status, r.stderr).toBe(0);
    return (JSON.parse(r.stdout) as { data: { records: { ref: string; status: string; file: string }[] } })
      .data.records;
  };

  it.each(["tiny", "medium", "messy"])("in %s, for every status and for the whole board", async (name) => {
    const dir = notebook(name);
    const v = await viewer(dir);
    const project = (readFileSync(join(dir, ".aimem/project.yaml"), "utf8").match(/^project: (.+)$/m) ??
      [])[1];
    const base = `/p/${project}/tasks`;
    const everything = list(dir);
    const board = refs((await get(v, base)).body);
    // The board caps a column, so it is a subset; the lists below are the whole.
    for (const r of board) expect(everything.map((x) => x.ref)).toContain(r);
    for (const status of [...STATUSES.task, "other"]) {
      const want = everything
        .filter((r) =>
          status === "other" ? !(STATUSES.task as readonly string[]).includes(r.status) : r.status === status,
        )
        .map((r) => r.ref);
      const got: string[] = [];
      for (let page = 1; page <= 20; page++) {
        const body = (await get(v, `${base}?status=${status}&page=${page}`)).body;
        const ids = refs(body);
        got.push(...ids);
        if (!body.includes(">Next</a>")) break;
      }
      expect(got.sort(), `${name} ${status}`).toEqual(want.sort());
      if (status !== "other" && want.length)
        expect(
          list(dir, "--status", status)
            .map((r) => r.ref)
            .sort(),
        ).toEqual(want.sort());
    }
  });

  it("in a project with a hub, tasks of the hub included", async () => {
    // The hub is a folder next to the repo, so the whole project is copied.
    const root = mkdtempSync(join(tmpdir(), "aimem-viewer-multi-"));
    try {
      cpSync(join(FIXTURES, "multirepo"), root, { recursive: true });
      await hub(join(root, "backend"));
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  async function hub(dir: string) {
    const v = await viewer(dir);
    const base = "/p/acme-shop/tasks";
    const want = list(dir)
      .map((r) => r.ref)
      .sort();
    expect(want.length).toBeGreaterThan(0);
    const got = refs((await get(v, `${base}?status=open`)).body).sort();
    expect(got).toEqual(
      list(dir, "--status", "open")
        .map((r) => r.ref)
        .sort(),
    );
    expect((await get(v, `${base}?status=open`)).body).toContain(">hub<");
    await v.close();
  }
});
