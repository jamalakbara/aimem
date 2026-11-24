import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clean, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const P = "/p/acme-ledger";
const XSS = `<img src=x onerror=alert(1)><script>alert(1)</script> [a](javascript:alert(1)) ![b](https://e.example/b.png)`;

/** Adds a memory copied from an existing one, with another id and body. */
function add(dir: string, id: string, body: string): void {
  const memory = join(dir, ".aimem/memory");
  const source = readFileSync(join(memory, readdirSync(memory).sort()[0] ?? ""), "utf8");
  const head = source.slice(0, source.indexOf("\n---", 4) + 4).replace(/^id: .*$/m, `id: ${id}`);
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, `${id}-added.md`), `${head}\n\n${body}\n`);
}

describe("record page over HTTP (24 §5.2)", () => {
  it("serves a record, its plain text and a 404, with the security headers", async () => {
    const dir = notebook();
    add(dir, "mem-zzzzzzzz", `# Why\n\n**bold** ${XSS}`);
    const v = await viewer(dir);
    const page = await get(v, `${P}/r/mem-zzzzzzzz`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.body).toContain("<strong>bold</strong>");
    expect(page.body).not.toMatch(/<img|<script(?! src="\/assets\/app\.js")|href="javascript/);
    const plain = await get(v, `${P}/r/mem-zzzzzzzz?view=plain`);
    expect(plain.body).toContain("**bold**");
    expect(plain.body).not.toContain("<strong>");
    expect((await get(v, `${P}/r/acme-ledger:mem-zzzzzzzz`)).status).toBe(200);
    const none = await get(v, `${P}/r/mem-yyyyyyyy`);
    expect(none.status).toBe(404);
    expect(none.body).toContain("Record not found");
  });

  it("finds records by reference only", async () => {
    const v = await viewer(notebook());
    for (const p of [
      `${P}/r`,
      `${P}/r/`,
      `${P}/r//`,
      `${P}/r/..%2f..%2f..%2fetc%2fpasswd`,
      `${P}/r/%2e%2e%5c%2e%2e%5cx`,
      `${P}/r/%2fetc%2fpasswd`,
      `${P}/r/.aimem/project.yaml`,
      `${P}/r/project.yaml`,
      `${P}/r/__proto__`,
      `${P}/r/constructor`,
      `/p/other/r/mem-zzzzzzzz`,
    ]) {
      const r = await get(v, p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).not.toMatch(/root:|mode: solo|etc/);
    }
  });

  it("shows an edit on the next request", async () => {
    const dir = notebook();
    add(dir, "mem-zzzzzzzz", "first words");
    const v = await viewer(dir);
    expect((await get(v, `${P}/r/mem-zzzzzzzz`)).body).toContain("first words");
    add(dir, "mem-zzzzzzzz", "other words");
    expect((await get(v, `${P}/r/mem-zzzzzzzz`)).body).toContain("other words");
  });

  it("links to the dashboard, and only to files it serves", async () => {
    const v = await viewer(notebook());
    const { body } = await get(v, P);
    expect(body).toContain(`href="${P}"`);
    for (const m of body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g))
      expect((await get(v, m[1] ?? "")).status, m[1]).toBe(200);
  });
});
