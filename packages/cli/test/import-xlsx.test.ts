import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom, readXlsx } from "@aimem/core";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
const random = cryptoRandom;
const human = { AIMEM_AUTHOR: "human:dana" };
const agent = { AIMEM_AUTHOR: "agent:claude-code" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-xlsx-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  cpSync(join(FIXTURES, "../imports"), join(dir, "docs"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("aimem import <file>.xlsx (M4b.2b)", () => {
  it("imports the named sheet of a workbook made by a spreadsheet library; date serials become dates", async () => {
    const r = await cli(
      ["import", join(dir, "docs/backlog.xlsx"), "--sheet", "Backlog", "--json", "--dir", dir],
      { env: human, random },
    );
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ type: "task", created: 2, sheet: "Backlog" });
    const first = r.json.data.rows[0];
    const text = readFileSync(
      join(dir, ".aimem/tasks", readdir(".aimem/tasks").find((f) => f.startsWith(first.ref)) ?? ""),
      "utf8",
    );
    expect(text).toMatch(/due: 2026-12-15/);
    expect(text).toMatch(/Rich & <text>/);
    const again = await cli(
      ["import", join(dir, "docs/backlog.xlsx"), "--sheet", "Backlog", "--json", "--dir", dir],
      { env: human, random },
    );
    expect(again.json.data).toMatchObject({ unchanged: 2 });
  });

  it("reports a wrong sheet name and a hostile archive without writing anything", async () => {
    const no = await cli(
      ["import", join(dir, "docs/backlog.xlsx"), "--sheet", "Nope", "--json", "--dir", dir],
      { env: human, random },
    );
    expect(no.code).toBe(2);
    expect(no.json.error.message).toMatch(/no sheet named 'Nope' \(sheets: Notes, Backlog\)/);
    const bomb = zipSync({
      "xl/workbook.xml": strToU8(`<workbook>${" ".repeat(30 * 1024 * 1024)}</workbook>`),
    });
    writeFileSync(join(dir, "docs/bomb.xlsx"), bomb);
    const b = await cli(["import", join(dir, "docs/bomb.xlsx"), "--json", "--dir", dir], {
      env: human,
      random,
    });
    expect(b.code).toBe(2);
    expect(b.json.error.message).toMatch(/bomb\.xlsx: xl\/workbook\.xml unpacks to more than 20 MB/);
  });
});

describe("aimem templates export --format xlsx (M4b.2b)", () => {
  it("writes a workbook with the sheet template's header row", async () => {
    const out = join(dir, "tasks-template.xlsx");
    const r = await cli(["templates", "export", "tasks", "--format", "xlsx", "--out", out, "--dir", dir], {
      env: human,
    });
    expect(r.code).toBe(0);
    const book = readXlsx(new Uint8Array(readFileSync(out)));
    expect(book.sheet).toBe("tasks");
    expect(book.rows).toEqual([
      ["title", "summary", "status", "priority", "assignee", "roles", "tags", "due", "paths", "notes"],
    ]);
    const stdout = await cli(["templates", "export", "tasks", "--format", "xlsx", "--json", "--dir", dir], {
      env: human,
    });
    expect(stdout.json.error.message).toMatch(/xlsx is binary: pass --out <file>/);
  });
});

describe("QA #100 notes", () => {
  it.skipIf(process.platform === "win32")(
    "templates --out refuses a symlink, even with --force",
    async () => {
      const far = mkdtempSync(join(tmpdir(), "aimem-far-"));
      try {
        writeFileSync(join(far, "precious.csv"), "keep");
        symlinkSync(join(far, "precious.csv"), join(dir, "docs/lnk.csv"));
        const r = await cli(
          [
            "templates",
            "export",
            "tasks",
            "--out",
            join(dir, "docs/lnk.csv"),
            "--force",
            "--json",
            "--dir",
            dir,
          ],
          { env: agent },
        );
        expect(r.code).toBe(2);
        expect(r.json.error.message).toMatch(/is a symlink; write to a regular file/);
        expect(readFileSync(join(far, "precious.csv"), "utf8")).toBe("keep");
      } finally {
        rmSync(far, { recursive: true, force: true });
      }
    },
  );

  it("a held import lock names its file and how to clear it", async () => {
    mkdirSync(join(dir, ".aimem/.cache"), { recursive: true });
    writeFileSync(join(dir, ".aimem/.cache/import.lock"), `${process.pid} now`);
    const r = await cli(["import", join(dir, "docs/decision.md"), "--json", "--dir", dir], {
      env: { ...human, AIMEM_IMPORT_LOCK_WAIT_MS: "100" },
      random,
    });
    expect(r.json.error.message).toMatch(
      /\.aimem\/\.cache\/import\.lock; if no import is running, delete that file/,
    );
    expect(existsSync(join(dir, ".aimem/.cache/import.lock"))).toBe(true);
  });
});

const readdir = (rel: string): string[] => readdirSync(join(dir, rel));
