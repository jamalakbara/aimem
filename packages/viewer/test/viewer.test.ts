import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Fs, loadIndex, loadProject, nodeFs, summarizeNotebook } from "@aimem/core";
import { escapeHtml, html } from "@aimem/viewer";
import { afterEach, describe, expect, it } from "vitest";
import { clean, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const BIN = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));

describe("html", () => {
  it("escapes every value, also in attributes, and nests without escaping twice", () => {
    const evil = `<script>alert("1")</script>'&`;
    expect(escapeHtml(evil)).toBe("&lt;script&gt;alert(&quot;1&quot;)&lt;/script&gt;&#39;&amp;");
    expect(String(html`<a title="${evil}">${[html`<b>${evil}</b>`, null, false, undefined, 0]}</a>`)).toBe(
      `<a title="${escapeHtml(evil)}"><b>${escapeHtml(evil)}</b>0</a>`,
    );
    // An object that only looks like trusted HTML is escaped like any other value.
    expect(String(html`${{ html: "<i>", toString: () => "<i>" }}`)).toBe("&lt;i&gt;");
  });
});

describe("dashboard", () => {
  it("shows the same counts as aimem status, and where / leads", async () => {
    const dir = notebook("medium");
    const nb = await loadProject(nodeFs, dir);
    const s = summarizeNotebook(nb, await loadIndex(nb, { fs: nodeFs }), new Date("2026-10-12T00:00:00Z"));
    const v = await viewer(dir);
    const root = await get(v, "/");
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe(`/p/${nb.config.project}`);
    const b = (await get(v, `/p/${nb.config.project}`)).body;
    expect(b).toMatch(/Read-only/);
    expect(b).toContain(`${s.total} records`);
    const cells = [...b.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><td>(\d+)<\/td><\/tr>/g)].map((m) => [
      m[1],
      m[2],
      Number(m[3]),
    ]);
    expect(cells).toEqual(
      Object.entries(s.counts).flatMap(([t, by]) => Object.entries(by).map(([st, n]) => [t, st, n])),
    );
    expect(b).toMatch(new RegExp(`Agent-written[^0-9]*${s.unreviewed.agent}\\b`));
    expect(b).toMatch(new RegExp(`Inferred[^0-9]*${s.unreviewed.inferred}\\b`));
    if (s.lastHandoff) expect(b).toContain(escapeHtml(s.lastHandoff.summary));
    expect((await get(v, `/p/${nb.config.project}/`)).status).toBe(200);
  });

  it("escapes hostile text from records, project.yaml and file names", async () => {
    const dir = notebook();
    const evil = `<img src=x onerror=alert(1)>"'`;
    const y = join(dir, ".aimem/project.yaml");
    writeFileSync(
      y,
      `${readFileSync(y, "utf8").replace(/^name:.*\n/m, "")}\nname: ${JSON.stringify(evil)}\n`,
    );
    const h = join(dir, ".aimem/handoffs");
    const f = join(h, readdirSync(h).sort().at(-1) ?? "");
    writeFileSync(f, readFileSync(f, "utf8").replace(/^summary: .*$/m, `summary: ${JSON.stringify(evil)}`));
    if (process.platform !== "win32") writeFileSync(join(dir, ".aimem/memory/<svg onload=x>.md"), "x");
    const b = (await get(await viewer(dir), "/p/acme-ledger")).body;
    expect(b).not.toMatch(/<img|<svg/);
    expect(b).toContain(escapeHtml(evil));
    // Nothing inline: the CSP would block it.
    expect(b).not.toMatch(/<style|<[^>]*\s(style|on[a-z]+)=|<script(?! src="\/assets\/app\.js")/);
  });

  it("gives a 500 page without paths or stack when a handler fails", async () => {
    const dir = notebook();
    let broken = false;
    const v = await viewer(dir);
    v.onRender(() => {
      if (broken) throw new Error(`boom at ${dir}`);
    });
    broken = true;
    const r = await get(v, "/p/acme-ledger");
    expect(r.status).toBe(500);
    expect(r.body).toContain("This page could not be shown");
    expect(r.body).not.toMatch(/boom|\.[jt]s:\d|aimem-viewer-/);
    broken = false;
    expect((await get(v, "/p/acme-ledger")).status).toBe(200);
  });
});

describe("read-only", () => {
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

  it("changes nothing in the project, whatever is requested", async () => {
    const dir = notebook();
    const id = (await loadIndex(await loadProject(nodeFs, dir), { fs: nodeFs })).records[0]?.id ?? "";
    const before = tree(dir);
    const v = await viewer(dir);
    for (const p of [
      "/",
      "/p/acme-ledger",
      "/assets/style.css",
      "/assets/app.js",
      "/x",
      "/p/acme-ledger/r/x",
      `/p/acme-ledger/r/${id}`,
      `/p/acme-ledger/r/${id}?view=plain`,
    ])
      for (const method of ["GET", "HEAD", "POST", "DELETE"]) await get(v, p, { method });
    expect(tree(dir)).toEqual(before);
  });

  it("never calls a writing file operation", async () => {
    const dir = notebook();
    const calls: string[] = [];
    const fs = new Proxy(nodeFs, {
      get: (t, k: keyof Fs) =>
        ["readFile", "readdir", "stat", "lstat", "realpath"].includes(k)
          ? t[k]
          : () => {
              calls.push(k);
              throw new Error(k);
            },
    });
    const v = await viewer(dir, { fs });
    expect((await get(v, "/p/acme-ledger")).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("imports only what it needs: no process, file or network client API", () => {
    const files = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        const spec = m[1] ?? "";
        expect(
          spec.startsWith(".") ||
            ["node:http", "node:path", "@aimem/core", "@aimem/schema", "markdown-it"].includes(spec),
          `${f}: ${spec}`,
        ).toBe(true);
      }
      expect(text, f).not.toMatch(
        /\brequire\(|process\.|eval\(|new Function|fetch\(|http\.request|from "node:http".*request/,
      );
      expect(text, f).not.toMatch(/\.(writeFile|appendFile|createExclusive|rename|unlink|mkdir|chmod)\(/);
    }
  });
});

describe("aimem serve web (built CLI)", () => {
  const env = { ...process.env, AIMEM_HOME: "/nonexistent-aimem-home" };
  const serve = (args: string[], cwd: string) => {
    const p = spawn(process.execPath, [BIN, "serve", "web", ...args], { cwd, env });
    let out = "";
    let err = "";
    const exit = new Promise<number | null>((d) => p.on("close", (c) => d(c)));
    p.stderr.on("data", (d) => {
      err += d;
    });
    const url = new Promise<string>((done, fail) => {
      p.stdout.on("data", (d) => {
        out += d;
        const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(out);
        if (m) done(m[0]);
      });
      exit.then((c) => fail(new Error(`exited ${c}: ${err}`)));
    });
    url.catch(() => undefined);
    return { p, url, exit, out: () => out, err: () => err };
  };

  it("serves the notebook, prints its URL and stops on a signal", async () => {
    const dir = notebook();
    const s = serve(["--port", "0"], dir);
    const url = await s.url;
    const r = await fetch(`${url}p/acme-ledger`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("8 records");
    expect(s.out()).toMatch(/read-only/i);
    s.p.kill("SIGINT");
    const code = await s.exit;
    if (process.platform !== "win32") expect(code).toBe(0);
    await expect(fetch(url)).rejects.toThrow();
  });

  it("fails clearly outside a notebook, on a taken port and on a bad port", async () => {
    const empty = mkdtempSync(join(tmpdir(), "aimem-viewer-none-"));
    const run = (args: string[], cwd: string) =>
      spawnSync(process.execPath, [BIN, "serve", "web", ...args], {
        cwd,
        env,
        encoding: "utf8",
        timeout: 20000,
      });
    const none = run(["--port", "0"], empty);
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/NOT_INITIALIZED/);
    rmSync(empty, { recursive: true });
    const dir = notebook();
    const blocker = createServer();
    await new Promise<void>((d) => blocker.listen(0, "127.0.0.1", () => d()));
    const taken = String((blocker.address() as { port: number }).port);
    const busy = serve(["--port", taken], dir);
    expect(await busy.exit).toBe(2);
    expect(busy.err()).toMatch(/port .*in use.*--port/s);
    blocker.close();
    for (const bad of ["x", "-1", "65536", "1.5", ""]) {
      const r = run([`--port=${bad}`], dir);
      expect(r.status, bad).toBe(2);
      expect(r.stderr).toMatch(/port/);
    }
    expect(run(["extra"], dir).status).not.toBe(0);
  });

  it("has no option to listen on another address", () => {
    const r = spawnSync(process.execPath, [BIN, "serve", "web", "--host", "0.0.0.0"], {
      cwd: notebook(),
      env,
      encoding: "utf8",
      timeout: 20000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown option/);
  });

  it("does not load the viewer for other commands", () => {
    const bin = readFileSync(BIN, "utf8");
    expect(bin).not.toMatch(/^import .*@aimem\/viewer/m);
    expect(bin).toMatch(/import\("@aimem\/viewer"\)/);
  });
});
