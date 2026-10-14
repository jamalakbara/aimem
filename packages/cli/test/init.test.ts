import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli } from "./helpers.js";

let parent: string;
let dir: string;
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "aimem-init-"));
  dir = join(parent, "My Cool_Project");
  mkdirSync(dir);
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

describe("init --solo", () => {
  it("creates the notebook layout and a clean, valid notebook", async () => {
    const r = await cli(["init", "--solo", "--json", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.json.data.project).toBe("my-cool-project");
    expect(r.json.data.files).toEqual([
      ".aimem/INDEX.md",
      ".aimem/decisions/.gitkeep",
      ".aimem/handoffs/.gitkeep",
      ".aimem/incidents/.gitkeep",
      ".aimem/memory/.gitkeep",
      ".aimem/project.yaml",
      ".aimem/runbooks/.gitkeep",
      ".aimem/schema/.gitkeep",
      ".aimem/tasks/.gitkeep",
      ".aimem/tests/.gitkeep",
      ".gitattributes",
      ".gitignore",
      "AGENTS.md",
    ]);
    expect(readFileSync(join(dir, ".aimem/project.yaml"), "utf8")).toBe(
      "aimem: 1\nproject: my-cool-project\nname: My Cool_Project\nmode: solo\nsync: none\nroles: [dev, pm, qa, db, devops, analyst]\nadapters:\n  targets: [agents]\n",
    );
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".aimem/.cache/\n");
    expect(readFileSync(join(dir, ".gitattributes"), "utf8")).toBe(".aimem/INDEX.md merge=ours\n");
    expect(readFileSync(join(dir, ".aimem/INDEX.md"), "utf8")).toContain("no records yet");
    const v = await cli(["validate", "--strict", "--json", "--dir", dir]);
    expect(v.code).toBe(0);
  });

  it("returns the intake questions unless --no-intake", async () => {
    const r = await cli(["init", "--json", "--dir", dir]);
    expect(r.json.data.intake).toHaveLength(7);
    expect(r.json.data.intake[0]).toEqual({
      id: 1,
      question: "What is this project, who uses it, what does success look like?",
      creates: 'memory (kind fact, tag pinned, title "Project overview")',
    });
    rmSync(join(dir, ".aimem"), { recursive: true });
    const q = await cli(["init", "--no-intake", "--json", "--dir", dir]);
    expect(q.json.data).not.toHaveProperty("intake");
  });

  it("appends to existing .gitignore/.gitattributes without duplicating lines", async () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.aimem/.cache/\n");
    writeFileSync(join(dir, ".gitattributes"), "*.png binary");
    await cli(["init", "--dir", dir]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("node_modules/\n.aimem/.cache/\n");
    expect(readFileSync(join(dir, ".gitattributes"), "utf8")).toBe(
      "*.png binary\n.aimem/INDEX.md merge=ours\n",
    );
  });

  it("honours --project, --repo and --roles", async () => {
    await cli(["init", "--project", "acme", "--repo", "backend", "--roles", "dev,qa", "--dir", dir]);
    expect(readFileSync(join(dir, ".aimem/project.yaml"), "utf8")).toBe(
      "aimem: 1\nproject: acme\nname: My Cool_Project\nmode: solo\nsync: none\nrepo: backend\nroles: [dev, qa]\nadapters:\n  targets: [agents]\n",
    );
  });

  it("refuses an existing notebook unless --force, and --force never touches records", async () => {
    await cli(["init", "--dir", dir]);
    writeFileSync(join(dir, ".aimem/memory/mem-0123abcd-keep.md"), "keep me\n");
    const again = await cli(["init", "--json", "--dir", dir]);
    expect(again.code).toBe(2);
    expect(again.json.error.code).toBe("USAGE");
    const forced = await cli(["init", "--force", "--json", "--dir", dir]);
    expect(forced.code).toBe(0);
    expect(readFileSync(join(dir, ".aimem/memory/mem-0123abcd-keep.md"), "utf8")).toBe("keep me\n");
    expect(readdirSync(join(dir, ".aimem/memory")).sort()).toEqual([".gitkeep", "mem-0123abcd-keep.md"]);
  });

  it("--adapters picks targets; none skips them; an existing CLAUDE.md gets the block too", async () => {
    const none = await cli(["init", "--adapters", "none", "--json", "--dir", dir]);
    expect(none.json.data.files).not.toContain("AGENTS.md");
    expect(readFileSync(join(dir, ".aimem/project.yaml"), "utf8")).toContain("targets: []");
    const picked = await cli(["init", "--force", "--adapters", "agents,cursor", "--json", "--dir", dir]);
    expect(picked.json.data.files).toEqual(expect.arrayContaining(["AGENTS.md", ".cursor/rules/aimem.mdc"]));
    rmSync(join(dir, ".aimem"), { recursive: true });
    rmSync(join(dir, "AGENTS.md"));
    writeFileSync(join(dir, "CLAUDE.md"), "# Claude notes\n");
    const auto = await cli(["init", "--json", "--dir", dir]);
    expect(auto.json.data.files).toEqual(expect.arrayContaining(["AGENTS.md", "CLAUDE.md"]));
    expect(
      readFileSync(join(dir, "CLAUDE.md"), "utf8").startsWith("# Claude notes\n\n<!-- aimem:begin v1 -->"),
    ).toBe(true);
    expect(
      (await cli(["init", "--force", "--adapters", "vscode", "--json", "--dir", dir])).json.error.code,
    ).toBe("USAGE");
  });

  it("rejects an invalid project slug", async () => {
    const r = await cli(["init", "--project", "Not A Slug", "--json", "--dir", dir]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("USAGE");
  });
});

describe("index", () => {
  it("regenerates INDEX.md and reports whether it changed", async () => {
    await cli(["init", "--dir", dir]);
    const first = await cli(["index", "--json", "--dir", dir]);
    expect(first.json.data).toEqual({ written: false, records: 0, problems: [] });
    writeFileSync(join(dir, ".aimem/INDEX.md"), "hand edited\n");
    const second = await cli(["index", "--json", "--dir", dir]);
    expect(second.json.data.written).toBe(true);
  });
});
