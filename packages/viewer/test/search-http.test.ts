import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { SCRIPT } from "../src/assets/app.js";
import { clean, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const P = "/p/acme-ledger";

describe("search over HTTP (24 §5.3)", () => {
  it("serves results, the empty form and filters, with the security headers", async () => {
    const v = await viewer(notebook());
    const page = await get(v, `${P}/search?q=float`);
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.body).toMatch(/\d+ results? for “float”/);
    expect((await get(v, `${P}/search`)).body).toContain("Type a word to search");
    expect((await get(v, `${P}/search/`)).status).toBe(200);
    expect((await get(v, `${P}/search?q=float&type=decision`)).status).toBe(200);
    const head = await get(v, `${P}/search?q=float`, { method: "HEAD" });
    expect([head.status, head.body]).toEqual([200, ""]);
  });

  it("accepts a pasted tab", async () => {
    const v = await viewer(notebook());
    const r = await get(v, `${P}/search?q=float%09column`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("for “float column”");
  });

  it("answers 404 for anything below it and for another project", async () => {
    const v = await viewer(notebook());
    for (const p of [
      `${P}/search/x`,
      `${P}/search/..%2fr`,
      `${P}/searches`,
      `${P}/Search`,
      "/p/other/search",
      "/search",
    ])
      expect((await get(v, p)).status, p).toBe(404);
  });

  it("has the search box on every notebook page", async () => {
    const v = await viewer(notebook());
    for (const p of [P, `${P}/search`, `${P}/r/mem-zzzzzzzz`]) {
      const { body } = await get(v, p);
      expect(body.match(/<form /g), p).toHaveLength(1);
      expect(body).toContain(`action="${P}/search"`);
    }
  });

  it("finds an edit on the next request, and links lead to the record", async () => {
    const dir = notebook();
    const v = await viewer(dir);
    expect((await get(v, `${P}/search?q=quagga`)).body).toContain("No matching records");
    const f = join(dir, ".aimem/memory", readdirSync(join(dir, ".aimem/memory")).sort()[0] ?? "");
    writeFileSync(f, `${readFileSync(f, "utf8")}\nA quagga was here.\n`);
    const { body } = await get(v, `${P}/search?q=quagga`);
    expect(body).toContain("A quagga was here.");
    const href = /<a id="r-[^"]+" href="([^"]+)"/.exec(body)?.[1] ?? "";
    expect((await get(v, href)).status).toBe(200);
  });

  it("changes nothing in the project", async () => {
    const dir = notebook();
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
    for (const q of ["q=float", "q=float&page=2", "q=", "q=dec-1&closed=1", `q=${"%E6%A4%9C".repeat(200)}`])
      for (const method of ["GET", "HEAD", "POST", "DELETE"]) await get(v, `${P}/search?${q}`, { method });
    expect(tree()).toEqual(before);
  });

  it("the script never writes markup or leaves the page", () => {
    expect(SCRIPT).not.toMatch(
      /innerHTML|outerHTML|insertAdjacent|document\.write|eval|Function\(|fetch|XMLHttp|location\s*=|\.href\s*=/,
    );
  });
});

describe("the script", () => {
  /** Runs the script against a stand-in for the few browser objects it uses. */
  function page(o: { platform?: string; hash?: string; box?: boolean; anchors?: string[] } = {}) {
    const log: string[] = [];
    const handlers: ((e: Record<string, unknown>) => void)[] = [];
    const box = { focus: () => log.push("focus q"), select: () => log.push("select q") };
    const anchors = (o.anchors ?? []).map((id) => ({
      id,
      click: () => undefined as unknown,
      focus: () => log.push(`focus ${id}`),
      addEventListener(_: string, f: () => unknown) {
        this.click = f;
      },
    }));
    const document = {
      getElementById: (id: string) =>
        id === "q" ? (o.box === false ? null : box) : (anchors.find((a) => a.id === id) ?? null),
      querySelectorAll: (css: string) => (css === 'a[id^="r-"]' ? anchors : []),
    };
    runInNewContext(SCRIPT, {
      document,
      navigator: { platform: o.platform ?? "Linux x86_64" },
      location: { hash: o.hash ?? "" },
      history: { replaceState: (...a: unknown[]) => log.push(`replace ${a[2]}`) },
      addEventListener: (_: string, f: (e: Record<string, unknown>) => void) => handlers.push(f),
    });
    const press = (e: Record<string, unknown>) =>
      handlers[0]?.({ key: "k", preventDefault: () => log.push("prevent"), ...e });
    return { log, press, anchors };
  }

  it("focuses the search box on Ctrl+K, or Cmd+K on a Mac, and on nothing else", () => {
    const pressed = (e: Record<string, unknown>, o = {}) => {
      const p = page(o);
      p.press(e);
      return p.log.join();
    };
    const done = "prevent,focus q,select q";
    expect(pressed({ ctrlKey: true })).toBe(done);
    expect(pressed({ ctrlKey: true, key: "K" })).toBe(done);
    expect(pressed({ metaKey: true }, { platform: "MacIntel" })).toBe(done);
    for (const e of [
      {},
      { metaKey: true },
      { ctrlKey: true, key: "j" },
      { ctrlKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, metaKey: true },
      { ctrlKey: true, isComposing: true },
    ])
      expect(pressed(e), JSON.stringify(e)).toBe("");
    // On a Mac, Ctrl+K deletes to the end of the line in a text field.
    expect(pressed({ ctrlKey: true }, { platform: "MacIntel" })).toBe("");
    expect(pressed({ ctrlKey: true }, { box: false })).toBe("");
  });

  it("remembers the opened result and goes back to it", () => {
    const p = page({ anchors: ["r-mem-1", "r-mem-1-2"] });
    expect(p.log).toEqual([]);
    p.anchors[1]?.click();
    expect(p.log).toEqual(["replace #r-mem-1-2"]);
    expect(page({ anchors: ["r-mem-1"], hash: "#r-mem-1" }).log).toEqual(["focus r-mem-1"]);
    expect(page({ anchors: ["r-mem-1"], hash: "#r-gone" }).log).toEqual([]);
    expect(page({ hash: "#q" }).log).toEqual([]);
    expect(page({ hash: "#main" }).log).toEqual([]);
  });
});
