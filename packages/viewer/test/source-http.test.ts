import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { clean, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const BIN = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
const env = {
  ...process.env,
  AIMEM_HOME: "/nonexistent-aimem-home",
  AIMEM_AUTHOR: "human:tester",
  AIMEM_GOOGLE_CREDENTIALS: "",
  GOOGLE_APPLICATION_CREDENTIALS: "",
};
const run = (dir: string, args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args, "--json"], { cwd: dir, env, encoding: "utf8", timeout: 60000 });
const P = "/p/acme-ledger";

/** The command lines of the guide, as shown. */
const commands = (html: string) =>
  [...html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)]
    .flatMap((m) => (m[1] ?? "").split("\n"))
    .map((l) =>
      l
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim(),
    )
    .filter(Boolean);

describe("the import guide over HTTP (24 §5.7)", () => {
  it("serves the guide, and nothing below it or by another method", async () => {
    const v = await viewer(notebook());
    for (const path of [`${P}/import`, `${P}/import/`, `${P}/import?lens=qa&x=1`]) {
      const r = await get(v, path);
      expect(r.status, path).toBe(200);
      expect(r.headers["content-security-policy"]).toContain("form-action 'self'");
    }
    const head = await get(v, `${P}/import`, { method: "HEAD" });
    expect([head.status, head.body]).toEqual([200, ""]);
    for (const path of [
      `${P}/import/x`,
      `${P}/Import`,
      `${P}/imports`,
      "/p/other/import",
      "/import",
      `${P}/upload`,
    ])
      expect((await get(v, path)).status, path).toBe(404);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await get(v, `${P}/import`, { method, body: "file=x", headers: { "content-length": "6" } });
      expect(r.status, method).toBe(405);
    }
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
            ? `${f} ${s.mtimeMs} ${createHash("sha256")
                .update(readFileSync(join(dir, f)))
                .digest("hex")}`
            : f;
        });
    const before = tree();
    const v = await viewer(dir);
    for (const method of ["GET", "HEAD", "POST", "PUT"]) await get(v, `${P}/import`, { method });
    expect(tree()).toEqual(before);
  });

  it("shows only commands that the CLI knows, and they work in the order of the guide", {
    timeout: 240_000,
  }, async () => {
    const dir = notebook();
    const v = await viewer(dir);
    const lines = commands((await get(v, `${P}/import`)).body);
    expect(lines.length).toBeGreaterThan(8);
    writeFileSync(
      join(dir, "notes.md"),
      "# Release notes\n\nThe export now keeps the column order of the ledger.\n",
    );
    let imported = "";
    for (const line of lines) {
      expect(line.startsWith("aimem "), line).toBe(true);
      const args = line
        .slice(6)
        .split(/\s+/)
        .map((a) => (a === "<folder-id>" ? "1AbCdEfGhIjKlMnOpQrStUv" : a === "<ref>" ? imported : a));
      const r = run(dir, args);
      const out = JSON.parse(r.stdout || "{}") as {
        ok?: boolean;
        data?: { ref?: string };
        error?: { code?: string };
      };
      // Without a Google key, syncing stops at the sign-in; every other command succeeds.
      if (args[0] === "sources" && args[1] === "sync") expect(out.error?.code, line).toBe("SOURCE_AUTH");
      else expect(out.ok, `${line}: ${r.stdout}${r.stderr}`).toBe(true);
      if (line === "aimem import notes.md") imported = out.data?.ref ?? "";
      if (line.includes("templates export")) {
        const file = join(dir, "tasks.csv");
        writeFileSync(file, `${readFileSync(file, "utf8").trim()}\nCheck the totals\n`);
      }
    }
  });
});

describe("records that were really imported (24 §5.7)", () => {
  it("name their source on the record and in the lists, without a link for a file", {
    timeout: 120_000,
  }, async () => {
    const dir = notebook();
    writeFileSync(
      join(dir, "notes.md"),
      "# Release notes\n\nThe export now keeps the column order of the ledger.\n",
    );
    const r = run(dir, ["import", "notes.md"]);
    expect(r.status, r.stderr).toBe(0);
    const ref = (JSON.parse(r.stdout) as { data: { ref: string } }).data.ref;
    const v = await viewer(dir);
    const record = (await get(v, `${P}/r/${ref}`)).body;
    expect(record).toContain("Source: Imported file");
    expect(record).not.toContain("Edit at source");
    expect(record).not.toContain('href="file:');
    expect((await get(v, `${P}/records?type=memory`)).body).toContain("Source: Imported file");
    // The same record as Google would leave it: the file now has a Google source.
    const memory = join(dir, ".aimem/memory");
    const file = readdirSync(memory).find((f) => f.startsWith(ref)) ?? "";
    const text = readFileSync(join(memory, file), "utf8")
      .replace("system: upload", "system: google-doc")
      .replace(/url: .*/, "url: https://docs.google.com/document/d/abc/edit");
    writeFileSync(join(memory, file), text);
    const after = (await get(v, `${P}/r/${ref}`)).body;
    expect(after).toContain(
      'rel="noopener noreferrer" href="https://docs.google.com/document/d/abc/edit">Edit at source</a>',
    );
    // After detach the notebook owns it: no label and no link.
    expect(run(dir, ["detach", ref]).status).toBe(0);
    const detached = (await get(v, `${P}/r/${ref}`)).body;
    expect(detached).not.toContain("Edit at source");
    expect(detached).not.toContain("Source: Google Doc</p>");
  });
});
