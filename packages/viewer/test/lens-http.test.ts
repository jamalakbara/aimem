import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { clean, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const BIN = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
const env = { ...process.env, AIMEM_HOME: "/nonexistent-aimem-home" };
const refs = (html: string) => [...html.matchAll(/<li data-ref="([^"]+)"/g)].map((m) => m[1] ?? "");

describe("role lens over HTTP (24 §5.6)", () => {
  it("narrows lists as `aimem list` with the role rule does, closed records included", async () => {
    const dir = notebook("medium");
    const v = await viewer(dir);
    const P = "/p/aimem";
    let seen = 0;
    for (const [type, path] of [
      ["task", "tasks?status=done"],
      ["decision", "decisions"],
      ["handoff", "handoffs"],
      ["incident", "records?type=incident"],
    ] as const) {
      const r = spawnSync(process.execPath, [BIN, "list", type, "--json"], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 60000,
      });
      expect(r.status, r.stderr).toBe(0);
      const listed = (JSON.parse(r.stdout) as { data: { records: { ref: string; status: string }[] } }).data
        .records;
      const roles = new Map<string, string[]>();
      for (const f of readdirSync(join(dir, ".aimem"), { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".md"))) {
        const text = readFileSync(join(dir, ".aimem", f), "utf8");
        const id = /^id: (.+)$/m.exec(text)?.[1];
        const rs = /^roles: \[(.*)\]$/m
          .exec(text)?.[1]
          ?.split(",")
          .map((s) => s.trim());
        if (id && rs) roles.set(id, rs);
      }
      for (const lens of ["qa", "pm", "db"]) {
        const want = listed
          .filter(
            (x) =>
              (type !== "task" || x.status === "done") &&
              (roles.get(x.ref) ?? []).some((r) => r === lens || r === "all"),
          )
          .map((x) => x.ref)
          .sort();
        const got: string[] = [];
        let next: string | undefined = `${P}/${path}${path.includes("?") ? "&" : "?"}lens=${lens}`;
        for (let i = 0; next && i < 50; i++) {
          const b: string = (await get(v, next)).body;
          got.push(...refs(b));
          next = /<a class="button" rel="next" href="([^"]+)"/.exec(b)?.[1]?.replaceAll("&amp;", "&");
        }
        expect(got.sort(), `${type} ${lens}`).toEqual(want);
        seen += want.length;
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("reports a lens that is not a choice, and then shows every record", async () => {
    const v = await viewer(notebook("medium"));
    const all = refs((await get(v, "/p/aimem/decisions")).body);
    for (const lens of ["all", "nobody", "QA", ""]) {
      const b = (await get(v, `/p/aimem/decisions?lens=${lens}`)).body;
      expect(refs(b), lens).toEqual(all);
      expect(b.includes("is not one of the choices"), lens).toBe(lens !== "");
      expect(b, lens).not.toContain("Role:");
    }
    const qa = (await get(v, "/p/aimem/decisions?lens=qa")).body;
    expect(refs(qa).length).toBeLessThan(all.length);
    expect(qa).toContain("Role: qa");
  });

  it("never narrows search, and the record page does not read it", async () => {
    const v = await viewer(notebook("medium"));
    const P = "/p/aimem";
    for (const q of ["q=schema", "q=schema&closed=1", "q=task&type=task", "q=", "q=dec-094vmt9t"]) {
      const a = await get(v, `${P}/search?${q}`);
      const b = await get(v, `${P}/search?${q}&lens=qa`);
      expect(b.body, q).toBe(a.body);
    }
    expect((await get(v, `${P}/r/dec-094vmt9t?lens=qa`)).body).toBe(
      (await get(v, `${P}/r/dec-094vmt9t`)).body,
    );
  });

  it("serves the dashboard and lists with a lens, and keeps the notebook unchanged", async () => {
    const dir = notebook("medium");
    const tree = () =>
      readdirSync(dir, { recursive: true })
        .map(String)
        .sort()
        .map((f) => {
          const s = statSync(join(dir, f));
          return s.isFile()
            ? [
                f,
                s.mtimeMs,
                createHash("sha256")
                  .update(readFileSync(join(dir, f)))
                  .digest("hex"),
              ]
            : [f];
        });
    const before = tree();
    const v = await viewer(dir);
    for (const p of [
      "/p/aimem?lens=qa",
      "/p/aimem/tasks?lens=qa",
      "/p/aimem/records?lens=all",
      "/p/aimem?lens=%3Cb%3E",
    ])
      for (const method of ["GET", "HEAD", "POST"]) {
        const r = await get(v, p, { method });
        expect(r.status, `${method} ${p}`).toBe(method === "POST" ? 405 : 200);
        if (method === "GET") expect(r.body).not.toContain("<b>");
      }
    expect(tree()).toEqual(before);
  });
});
