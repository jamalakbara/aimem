import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adapterStatus,
  CURSOR_HEADER,
  defaultTargets,
  protocolBlock,
  removeAdapters,
  syncAdapters,
} from "@aimem/adapters";
import { loadProject, type Notebook, nodeFs } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let nb: Notebook;
const deps = { fs: nodeFs, random: { bytes: (n: number) => new Uint8Array(n).fill(3) } };
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-adapters-"));
  write(".aimem/project.yaml", "aimem: 1\nproject: demo\n");
  nb = await loadProject(nodeFs, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("defaultTargets", () => {
  it("is AGENTS.md only, plus CLAUDE.md when it exists and does not import AGENTS.md", async () => {
    expect(await defaultTargets(nb, nodeFs)).toEqual(["agents"]);
    write("CLAUDE.md", "# Claude\n");
    expect(await defaultTargets(nb, nodeFs)).toEqual(["agents", "claude"]);
    write("CLAUDE.md", "@AGENTS.md\n");
    expect(await defaultTargets(nb, nodeFs)).toEqual(["agents"]);
  });
});

describe("syncAdapters", () => {
  it("creates, then reports nothing to do on the second run", async () => {
    const first = await syncAdapters(nb, deps, { targets: ["agents", "copilot", "gemini", "cursor"] });
    expect(first.map((r) => [r.target, r.action])).toEqual([
      ["agents", "created"],
      ["copilot", "created"],
      ["gemini", "created"],
      ["cursor", "created"],
    ]);
    expect(read(".cursor/rules/aimem.mdc")).toBe(`${CURSOR_HEADER}${protocolBlock()}\n`);
    expect(read(".github/copilot-instructions.md")).toBe(`${protocolBlock()}\n`);
    const second = await syncAdapters(nb, deps, { targets: ["agents", "copilot", "gemini", "cursor"] });
    expect(second.every((r) => r.action === "unchanged")).toBe(true);
  });

  it("appends to existing files and updates outdated blocks only", async () => {
    write("AGENTS.md", "# House rules\n\nUse tabs.\n");
    await syncAdapters(nb, deps, { targets: ["agents"] });
    expect(read("AGENTS.md")).toBe(`# House rules\n\nUse tabs.\n\n${protocolBlock()}\n`);
    write("AGENTS.md", read("AGENTS.md").replace("START", "OLD"));
    const r = await syncAdapters(nb, deps, { targets: ["agents"] });
    expect(r[0]?.action).toBe("updated");
    expect(read("AGENTS.md")).toBe(`# House rules\n\nUse tabs.\n\n${protocolBlock()}\n`);
  });

  it("skips CLAUDE.md that imports AGENTS.md", async () => {
    write("CLAUDE.md", "@AGENTS.md\n");
    const r = await syncAdapters(nb, deps, { targets: ["agents", "claude"] });
    expect(r.find((x) => x.target === "claude")).toMatchObject({
      action: "skipped",
      note: "imports AGENTS.md",
    });
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  it("reports a broken block and leaves that file untouched, still syncing the others", async () => {
    write("AGENTS.md", "<!-- aimem:begin v1 -->\nhalf a block\n");
    const r = await syncAdapters(nb, deps, { targets: ["agents", "gemini"] });
    expect(r.map((x) => [x.target, x.action])).toEqual([
      ["agents", "broken"],
      ["gemini", "created"],
    ]);
    expect(read("AGENTS.md")).toBe("<!-- aimem:begin v1 -->\nhalf a block\n");
  });

  it("handles custom files", async () => {
    const r = await syncAdapters(nb, deps, { targets: [], files: ["docs/AI.md"] });
    expect(r).toEqual([{ target: "file", file: "docs/AI.md", action: "created" }]);
  });

  it("refuses paths outside the repository", async () => {
    await expect(syncAdapters(nb, deps, { targets: [], files: ["../outside.md"] })).rejects.toThrow(
      /inside the repository/,
    );
  });
});

describe("removeAdapters", () => {
  it("restores pre-existing files byte for byte and deletes files aimem created", async () => {
    write("AGENTS.md", "# House rules\r\nUse tabs.");
    const before = read("AGENTS.md");
    await syncAdapters(nb, deps, { targets: ["agents", "cursor", "gemini"] });
    const r = await removeAdapters(nb, deps, { targets: ["agents", "cursor", "gemini"] });
    expect(r.map((x) => [x.target, x.action])).toEqual([
      ["agents", "removed"],
      ["cursor", "deleted"],
      ["gemini", "deleted"],
    ]);
    expect(read("AGENTS.md")).toBe(before);
    expect(existsSync(join(root, ".cursor/rules/aimem.mdc"))).toBe(false);
    expect(existsSync(join(root, "GEMINI.md"))).toBe(false);
  });

  it("reports absent blocks", async () => {
    const r = await removeAdapters(nb, deps, { targets: ["copilot"] });
    expect(r).toEqual([{ target: "copilot", file: ".github/copilot-instructions.md", action: "absent" }]);
  });
});

describe("adapterStatus", () => {
  it("lists each target's state", async () => {
    await syncAdapters(nb, deps, { targets: ["agents"] });
    write("GEMINI.md", `${protocolBlock().replace("v1", "v0")}\n`);
    const s = await adapterStatus(nb, nodeFs, { targets: ["agents", "claude", "gemini"] });
    expect(s.map((x) => [x.target, x.state])).toEqual([
      ["agents", "current"],
      ["claude", "missing"],
      ["gemini", "outdated"],
    ]);
  });
});
