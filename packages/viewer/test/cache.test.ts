import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Fs, nodeFs } from "@aimem/core";
import { afterEach, describe, expect, it } from "vitest";
import { clean, get, notebook, viewer } from "./helpers.js";

afterEach(clean);
const posix = process.platform !== "win32";
const mem = (dir: string) => join(dir, ".aimem/memory");
const first = (dir: string) => join(mem(dir), readdirSync(mem(dir)).sort()[0] ?? "");
const total = (body: string) => Number(/(\d+) records?\b/.exec(body)?.[1]);
const page = async (v: Awaited<ReturnType<typeof viewer>>) => (await get(v, "/p/acme-ledger")).body;

describe("reading the notebook (24 §5.1 Cache)", () => {
  it("shows the same totals as the notebook and notices new, changed and deleted records", async () => {
    const dir = notebook();
    const v = await viewer(dir);
    const n = total(await page(v));
    expect(n).toBe(8);
    const text = readFileSync(first(dir), "utf8");
    const extra = join(mem(dir), "mem-zzzz2222-extra.md");
    writeFileSync(extra, text.replace(/^id: .*$/m, "id: mem-zzzz2222"));
    expect(total(await page(v))).toBe(9);
    writeFileSync(
      extra,
      text.replace(/^id: .*$/m, "id: mem-zzzz2222").replace(/^trust: .*$/m, "trust: inferred"),
    );
    expect(await page(v)).toMatch(/Inferred[^0-9]*1/);
    unlinkSync(extra);
    expect(total(await page(v))).toBe(8);
  });

  it("notices an edit that keeps size and modification time", async () => {
    const dir = notebook();
    const v = await viewer(dir);
    const f = first(dir);
    // Whole seconds, so that the second utimes restores exactly the same time.
    utimesSync(f, 1_700_000_000, 1_700_000_000);
    const s = statSync(f);
    expect(await page(v)).not.toContain("activE");
    const before = readFileSync(f, "utf8");
    expect(before).toMatch(/^status: active$/m);
    writeFileSync(f, before.replace(/^status: active$/m, "status: activE"));
    utimesSync(f, 1_700_000_000, 1_700_000_000);
    expect(statSync(f)).toMatchObject({ size: s.size, mtimeMs: s.mtimeMs, ino: s.ino });
    expect(await page(v)).toContain("activE");
  });

  it("does not read records again when nothing changed", async () => {
    const dir = notebook();
    let reads = 0;
    const fs: Fs = {
      ...nodeFs,
      readRegular: async (p, max) => {
        if (p.endsWith(".md")) reads++;
        return (await nodeFs.readRegular?.(p, max)) ?? "";
      },
    };
    const v = await viewer(dir, { fs });
    await page(v);
    const after = reads;
    expect(after).toBeGreaterThan(0);
    await Promise.all(Array.from({ length: 10 }, () => page(v)));
    expect(reads).toBe(after);
  });

  it("loads once for many requests at the same time", async () => {
    const dir = notebook();
    let reads = 0;
    const fs: Fs = {
      ...nodeFs,
      readRegular: async (p, max) => {
        if (p.endsWith(".md")) {
          reads++;
          await new Promise((r) => setTimeout(r, 5));
        }
        return (await nodeFs.readRegular?.(p, max)) ?? "";
      },
    };
    const v = await viewer(dir, { fs });
    await Promise.all(Array.from({ length: 10 }, () => page(v)));
    expect(reads).toBe(8);
  });

  it("leaves out odd entries with a notice and shows the rest", async () => {
    const dir = notebook();
    mkdirSync(join(mem(dir), "mem-dddd2222-dir.md"));
    writeFileSync(join(mem(dir), "mem-eeee2222-huge.md"), "---\n");
    truncateSync(join(mem(dir), "mem-eeee2222-huge.md"), 11 * 1024 * 1024);
    writeFileSync(join(mem(dir), "mem-ffff2222-bad.md"), Buffer.from([0xff, 0xfe, 0x2d]));
    const b = await page(await viewer(dir));
    expect(total(b)).toBe(8);
    expect(b).toMatch(/mem-dddd2222-dir\.md[\s\S]*not a regular file/);
    expect(b).toMatch(/mem-eeee2222-huge\.md[\s\S]*larger than 10 MB/);
    expect(b).toMatch(/mem-ffff2222-bad\.md/);
  });

  it.skipIf(!posix)("never opens a FIFO, a link or a linked folder", async () => {
    const dir = notebook();
    const secret = join(tmpdir(), `aimem-viewer-secret-${process.pid}.md`);
    writeFileSync(secret, readFileSync(first(dir), "utf8").replace(/^id: .*$/m, "id: mem-ssss2222"));
    try {
      symlinkSync(secret, join(mem(dir), "mem-ssss2222-link.md"));
      symlinkSync("/nonexistent", join(mem(dir), "mem-tttt2222-dangling.md"));
      execFileSync("mkfifo", [join(mem(dir), "mem-vvvv2222-fifo.md")]);
      renameSync(join(dir, ".aimem/decisions"), join(dir, "elsewhere"));
      symlinkSync(join(dir, "elsewhere"), join(dir, ".aimem/decisions"));
      const opened: string[] = [];
      const fs: Fs = {
        ...nodeFs,
        readRegular: async (p, max) => {
          opened.push(p);
          return (await nodeFs.readRegular?.(p, max)) ?? "";
        },
      };
      const b = await page(await viewer(dir, { fs }));
      expect(b).toMatch(/mem-ssss2222-link\.md[\s\S]*link/);
      expect(b).toMatch(/mem-tttt2222-dangling\.md[\s\S]*link/);
      expect(b).toMatch(/mem-vvvv2222-fifo\.md[\s\S]*not a regular file/);
      expect(b).toMatch(/\.aimem\/decisions[\s\S]*linked folder/);
      expect(opened.filter((p) => /ssss|tttt|vvvv|decisions|elsewhere/.test(p))).toEqual([]);
    } finally {
      rmSync(secret);
    }
  });

  it("survives a file that disappears while loading", async () => {
    const dir = notebook();
    let hit = false;
    const fs: Fs = {
      ...nodeFs,
      readRegular: async (p, max) => {
        if (!hit && p === first(dir)) {
          hit = true;
          unlinkSync(p);
        }
        return (await nodeFs.readRegular?.(p, max)) ?? "";
      },
    };
    const r = await get(await viewer(dir, { fs }), "/p/acme-ledger");
    expect(r.status).toBe(200);
    expect(total(r.body)).toBe(7);
  });

  it("loads again when a file changes during the load", async () => {
    const dir = notebook();
    let hit = false;
    const fs: Fs = {
      ...nodeFs,
      readRegular: async (p, max) => {
        const text = (await nodeFs.readRegular?.(p, max)) ?? "";
        if (!hit && p === first(dir)) {
          hit = true;
          appendFileSync(p, "\nmore\n");
          writeFileSync(join(mem(dir), "mem-zzzz3333-new.md"), text.replace(/^id: .*$/m, "id: mem-zzzz3333"));
        }
        return text;
      },
    };
    expect(total(await page(await viewer(dir, { fs })))).toBe(9);
  });

  it("keeps the last good index with a notice when project.yaml breaks, and recovers", async () => {
    const dir = notebook();
    const v = await viewer(dir);
    await page(v);
    const y = join(dir, ".aimem/project.yaml");
    const good = readFileSync(y, "utf8");
    writeFileSync(y, "project: [");
    const broken = await get(v, "/p/acme-ledger");
    expect(broken.status).toBe(200);
    expect(total(broken.body)).toBe(8);
    expect(broken.body).toMatch(/could not refresh/i);
    writeFileSync(y, good);
    expect(await page(v)).not.toMatch(/could not refresh/i);
    rmSync(join(dir, ".aimem"), { recursive: true });
    expect((await get(v, "/p/acme-ledger")).body).toMatch(/could not refresh/i);
  });

  it("answers 503 when the first load fails, and within the limit when a read hangs", async () => {
    const dir = notebook();
    let mode: "hang" | "ok" = "hang";
    const fs: Fs = {
      ...nodeFs,
      readRegular: async (p, max) =>
        p.endsWith(".md") && mode === "hang"
          ? new Promise<string>(() => undefined)
          : ((await nodeFs.readRegular?.(p, max)) ?? ""),
    };
    const v = await viewer(dir, { fs, loadMs: 300 });
    const t0 = Date.now();
    const r = await get(v, "/p/acme-ledger");
    expect(r.status).toBe(503);
    expect(r.body).not.toContain(dir);
    expect((await get(v, "/p/acme-ledger")).status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(5000);
    mode = "ok";
    expect(r.body).toMatch(/restart aimem serve web/i);
    expect((await get(v, "/assets/style.css")).status).toBe(200);
  });

  it("includes hub and sibling notebooks and warns about missing ones", async () => {
    const root = notebook("multirepo");
    const repos = readdirSync(root).filter((d) => existsSync(join(root, d, ".aimem/project.yaml")));
    expect(repos.length).toBeGreaterThan(1);
    const dir = join(
      root,
      repos.find((r) => /repos:|hub:/.test(readFileSync(join(root, r, ".aimem/project.yaml"), "utf8"))) ?? "",
    );
    const v = await viewer(dir);
    const name = /^project: (\S+)/m.exec(readFileSync(join(dir, ".aimem/project.yaml"), "utf8"))?.[1];
    const r = await get(v, `/p/${name}`);
    expect(r.status).toBe(200);
    const other = repos.map((x) => join(root, x)).find((x) => x !== dir) ?? "";
    const n = total(r.body);
    const own = join(other, ".aimem/memory");
    mkdirSync(own, { recursive: true });
    rmSync(other, { recursive: true });
    const after = (await get(v, `/p/${name}`)).body;
    expect(after === r.body && total(after) === n).toBe(false);
    expect(after).toMatch(/not checked out/);
    // A checkout that appears later but belongs to another project is noticed as well.
    expect(after).not.toMatch(/was skipped/);
    mkdirSync(join(root, "infra/.aimem"), { recursive: true });
    writeFileSync(join(root, "infra/.aimem/project.yaml"), "aimem: 1\nproject: another\n");
    expect((await get(v, `/p/${name}`)).body).toMatch(/was skipped/);
  });

  it.skipIf(!posix)(
    "does not follow .aimem when it is a link, at the start, later, or in a hub",
    async () => {
      const dir = notebook();
      const other = notebook("medium");
      renameSync(join(dir, ".aimem"), join(dir, "real"));
      symlinkSync(join(other, ".aimem"), join(dir, ".aimem"));
      await expect(viewer(dir)).rejects.toThrow(/\.aimem is a link/);
      unlinkSync(join(dir, ".aimem"));
      renameSync(join(dir, "real"), join(dir, ".aimem"));
      const v = await viewer(dir);
      await page(v);
      renameSync(join(dir, ".aimem"), join(dir, "real"));
      symlinkSync(join(other, ".aimem"), join(dir, ".aimem"));
      const b = await page(v);
      expect(total(b)).toBe(8);
      expect(b).toMatch(/could not refresh/i);

      const root = notebook("multirepo");
      const before = total((await get(await viewer(join(root, "backend")), "/p/acme-shop")).body);
      const hub = join(root, "shop-hub");
      renameSync(join(hub, ".aimem"), join(root, "moved"));
      symlinkSync(join(root, "moved"), join(hub, ".aimem"));
      const after = (await get(await viewer(join(root, "backend")), "/p/acme-shop")).body;
      expect(total(after)).toBeLessThan(before);
      expect(after).toMatch(/hub is not checked out/);
    },
  );

  it.skipIf(!posix || process.getuid?.() === 0)("says which folder cannot be listed", async () => {
    const dir = notebook();
    chmodSync(mem(dir), 0o000);
    try {
      const b = await page(await viewer(dir));
      expect(b).toMatch(/\.aimem\/memory[\s\S]*cannot be listed/);
    } finally {
      chmodSync(mem(dir), 0o755);
    }
  });

  it.skipIf(!posix || process.getuid?.() === 0)(
    "says what is wrong with project.yaml at the start",
    async () => {
      const y = (d: string) => join(d, ".aimem/project.yaml");
      const a = notebook();
      chmodSync(y(a), 0o000);
      await expect(viewer(a)).rejects.toThrow(/project\.yaml.*cannot be read/);
      const b = notebook();
      renameSync(y(b), join(b, "p.yaml"));
      symlinkSync(join(b, "p.yaml"), y(b));
      await expect(viewer(b)).rejects.toThrow(/project\.yaml.*a link/);
      const c = notebook();
      unlinkSync(y(c));
      execFileSync("mkfifo", [y(c)]);
      await expect(viewer(c)).rejects.toThrow(/project\.yaml.*not a regular file/);
    },
  );

  it.skipIf(!posix)("does not hang or leak when an entry is swapped after it was checked", async () => {
    for (const swap of [
      (p: string) => execFileSync("mkfifo", [p]),
      (p: string) => symlinkSync("/etc/hostname", p),
      (p: string) => mkdirSync(p),
    ]) {
      const dir = notebook();
      const f = first(dir);
      let looks = 0;
      let opened = "";
      const fs: Fs = {
        ...nodeFs,
        readRegular: async (p, max) => {
          const text = (await nodeFs.readRegular?.(p, max)) ?? "";
          if (p === f) opened = text;
          return text;
        },
        lstat: async (p) => {
          const s = await nodeFs.lstat?.(p);
          if (!s) throw new Error("no lstat");
          // First look: the signature. Second: the check right before the read.
          if (p === f && ++looks === 2) {
            unlinkSync(p);
            swap(p);
          }
          return s;
        },
      };
      const v = await viewer(dir, { fs, loadMs: 3000 });
      const r = await get(v, "/p/acme-ledger");
      expect(r.status).toBe(200);
      expect(total(r.body)).toBe(7);
      expect(looks).toBeGreaterThan(1);
      expect(opened).toBe("");
    }
  });
});
