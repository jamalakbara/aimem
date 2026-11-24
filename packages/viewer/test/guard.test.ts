import type { Viewer } from "@aimem/viewer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clean, get, notebook, raw, viewer } from "./helpers.js";

let v: Viewer;
let host: string;
beforeAll(async () => {
  v = await viewer(notebook());
  host = `127.0.0.1:${v.port}`;
});
afterAll(clean);
const status = async (text: string) => Number(/^HTTP\/1\.1 (\d+)/.exec(await raw(v, text))?.[1] ?? 0);

describe("request guard (24 §5.1)", () => {
  it("listens on 127.0.0.1 only and prints that URL", () => {
    expect(v.address).toBe("127.0.0.1");
    expect(v.url).toBe(`http://127.0.0.1:${v.port}/`);
  });

  it("accepts localhost and 127.0.0.1 with the actual port", async () => {
    for (const h of [host, `localhost:${v.port}`, `LOCALHOST:${v.port}`])
      expect(await status(`GET /p/acme-ledger HTTP/1.1\r\nHost: ${h}\r\nConnection: close\r\n\r\n`), h).toBe(
        200,
      );
  });

  it("refuses every other Host with 421 (DNS rebinding)", async () => {
    for (const h of [
      "evil.example",
      `evil.example:${v.port}`,
      "127.0.0.1",
      "localhost",
      `127.0.0.1:${v.port + 1}`,
      `localhost.:${v.port}`,
      `localhost.evil.example:${v.port}`,
      `[::1]:${v.port}`,
      `0.0.0.0:${v.port}`,
      `user@127.0.0.1:${v.port}`,
      `127.0.0.1:${v.port},evil.example`,
      "",
    ])
      expect(await status(`GET / HTTP/1.1\r\nHost: ${h}\r\n\r\n`), h).toBe(421);
  });

  it("refuses a missing Host (HTTP/1.0) and two Host headers", async () => {
    expect(await status("GET / HTTP/1.0\r\n\r\n")).toBe(421);
    expect(await status(`GET / HTTP/1.1\r\nHost: ${host}\r\nHost: ${host}\r\n\r\n`)).toBe(421);
    expect(await status(`GET / HTTP/1.1\r\nHost: ${host}\r\nhost: evil.example\r\n\r\n`)).toBe(421);
    expect(await status("GET / HTTP/1.1\r\n\r\n")).toBeGreaterThanOrEqual(400);
  });

  it("refuses absolute targets, // and bad percent-encoding with 400", async () => {
    for (const t of [
      "http://evil.example/",
      `http://${host}/`,
      "//evil.example/a",
      "*",
      "/%",
      "/p/%zz",
      "/p/%C0%AF",
      "/p/a%00b",
      "/p/a%0d%0aSet-Cookie:x",
      "/p/x?q=%zz",
    ])
      expect(await status(`GET ${t} HTTP/1.1\r\nHost: ${host}\r\n\r\n`), t).toBe(400);
  });

  it("answers 405 with Allow to every method but GET and HEAD", async () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "PROPFIND"]) {
      const r = await raw(v, `${m} / HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
      expect(r, m).toMatch(/^HTTP\/1\.1 405 /);
      expect(r, m).toMatch(/\r\nAllow: GET, HEAD\r\n/i);
    }
  });

  it("closes CONNECT and upgrade sockets without an answer", async () => {
    expect(await raw(v, `CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n\r\n`)).not.toMatch(/ 200 /);
    const up = await raw(
      v,
      `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    );
    expect(up).not.toMatch(/ (101|200|302) /);
  });

  it("lets other sites link to it but not load it in the background or in a frame", async () => {
    const f = (site: string, mode: string, dest: string) =>
      get(v, "/p/acme-ledger", {
        headers: { "sec-fetch-site": site, "sec-fetch-mode": mode, "sec-fetch-dest": dest },
      }).then((r) => r.status);
    for (const site of ["cross-site", "same-site"]) {
      expect(await f(site, "navigate", "document")).toBe(200);
      for (const [mode, dest] of [
        ["no-cors", "image"],
        ["cors", "empty"],
        ["navigate", "iframe"],
        ["navigate", "object"],
        ["no-cors", "script"],
        ["cors", "document"],
      ])
        expect(await f(site, mode as string, dest as string), `${site} ${mode} ${dest}`).toBe(403);
    }
    expect(await f("none", "navigate", "document")).toBe(200);
    expect(await f("same-origin", "cors", "empty")).toBe(200);
    expect(await f("weird", "cors", "empty")).toBe(403);
    expect(await f("weird", "navigate", "document")).toBe(403);
  });

  it("refuses a URL over 2 KB with 414", async () => {
    expect((await get(v, `/p/${"a".repeat(2100)}`)).status).toBe(414);
    expect((await get(v, `/p/${"a".repeat(1900)}`)).status).toBe(404);
  });

  it("does not read a request body and closes that connection", async () => {
    const r = await raw(
      v,
      `GET /p/acme-ledger HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 40\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: ${host}\r\n\r\n`,
    );
    expect(r.match(/HTTP\/1\.1 /g)).toHaveLength(1);
    expect(r).toMatch(/\r\nConnection: close\r\n/i);
    const e = await raw(
      v,
      `GET / HTTP/1.1\r\nHost: ${host}\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n`,
    );
    expect(e).not.toMatch(/100 Continue/);
  });

  it("ends slow requests and limits connections", async () => {
    const slow = await viewer(notebook(), { timeoutMs: 300 });
    const t0 = Date.now();
    await raw(slow, "GET / HTTP/1.1\r\nHost: x", 8000);
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(v.maxConnections).toBe(64);
  });

  it("sends the security headers with every answer, and no CORS header", async () => {
    const answers = [
      await get(v, "/"),
      await get(v, "/p/acme-ledger"),
      await get(v, "/assets/style.css"),
      await get(v, "/assets/app.js"),
      await get(v, "/nothing"),
      await get(v, "/p/acme-ledger", { method: "POST" }),
      await get(v, "/", { headers: { host: "evil.example" } }),
      await get(v, `/p/${"a".repeat(2100)}`),
    ];
    expect(answers.map((a) => a.status)).toEqual([302, 200, 200, 200, 404, 405, 421, 414]);
    for (const a of answers) {
      expect(a.headers["content-security-policy"]).toBe(
        "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      expect(a.headers["x-content-type-options"]).toBe("nosniff");
      expect(a.headers["referrer-policy"]).toBe("no-referrer");
      expect(a.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(a.headers["cross-origin-opener-policy"]).toBe("same-origin");
      expect(a.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(a.headers).filter((h) => h.startsWith("access-control"))).toEqual([]);
      expect(a.headers["x-powered-by"]).toBeUndefined();
    }
    const malformed = await raw(v, "NOT HTTP\r\n\r\n");
    expect(malformed).toMatch(/^HTTP\/1\.1 400 /);
    expect(malformed).toMatch(/X-Content-Type-Options: nosniff/i);
  });

  it("answers HEAD like GET without a body", async () => {
    const r = await get(v, "/p/acme-ledger", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.body).toBe("");
    expect(Number(r.headers["content-length"])).toBeGreaterThan(100);
  });

  it("serves nothing by file path", async () => {
    for (const p of [
      "/.aimem/project.yaml",
      "/.aimem/.cache/calls.jsonl",
      "/.env",
      "/.git/config",
      "/assets/../package.json",
      "/assets/..%2f..%2fpackage.json",
      "/assets/%2e%2e/%2e%2e/etc/passwd",
      "/assets/style.css/x",
      "/p/acme-ledger/..%5c..%5cwindows",
      "/p/../../etc/passwd",
      "/p/other-project",
    ]) {
      const r = await get(v, p);
      expect([404, 400], p).toContain(r.status);
      expect(r.body).not.toMatch(/aimem: 1|root:|"version"/);
    }
  });
});
