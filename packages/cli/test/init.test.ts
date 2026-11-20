import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaGit } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, fakeGit } from "./helpers.js";

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
      readFileSync(join(dir, "CLAUDE.md"), "utf8").startsWith("# Claude notes\n\n<!-- aimem:begin v2 -->"),
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

describe("init Git sync", () => {
  const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
  const ref = "refs/heads/aimem-live";
  const config = () => join(dir, ".aimem/project.yaml");
  const init = (args: string[], gitRunner = git) =>
    cli(["init", "--json", "--dir", dir, ...args], { git: gitRunner });

  async function sh(cwd: string, ...args: string[]): Promise<string> {
    const result = await git.run(args, cwd);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }

  async function setupOrigin(): Promise<string> {
    const remote = join(parent, "remote.git");
    await sh(parent, "init", "--bare", "-q", "-b", "main", remote);
    await sh(dir, "init", "-q", "-b", "main");
    await sh(dir, "config", "user.name", "Test User");
    await sh(dir, "config", "user.email", "fixture@example.com");
    await sh(dir, "remote", "add", "origin", remote);
    return remote;
  }

  it("creates the live branch without touching the current branch, index or working files", async () => {
    const remote = await setupOrigin();
    await sh(dir, "commit", "-q", "--allow-empty", "-m", "main");
    const head = await sh(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "work.txt"), "staged\n");
    await sh(dir, "add", "work.txt");
    const index = await sh(dir, "ls-files", "--stage");
    writeFileSync(join(dir, "work.txt"), "unstaged\n");

    const result = await init(["--team", "--no-intake"]);
    expect(result.code).toBe(0);
    expect(result.json.data).toEqual({ project: "my-cool-project", mode: "team", files: expect.any(Array) });
    expect(readFileSync(config(), "utf8")).toContain("sync: git");
    expect(await sh(dir, "rev-parse", "HEAD")).toBe(head);
    expect(await sh(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(await sh(dir, "ls-files", "--stage")).toBe(index);
    expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("unstaged\n");
    const live = await sh(remote, "rev-parse", ref);
    expect(await sh(remote, "rev-list", "--parents", ref)).toBe(live);
    expect(await sh(remote, "ls-tree", "-r", ref)).toBe("");
  });

  it("defaults to local team mode without origin and requires it for explicit git sync", async () => {
    const missing = await init(["--team", "--sync", "git"]);
    expect(missing.code).toBe(4);
    expect(missing.json.error.code).toBe("SYNC_FAILED");
    expect(existsSync(config())).toBe(false);
    const local = await init(["--team"]);
    expect(local.code).toBe(0);
    expect(local.json.warnings.join(" ")).toContain("origin");
    expect(readFileSync(config(), "utf8")).toContain("sync: none");
  });

  it.each([
    { mode: "offline", flags: ["--offline"], sync: "git" },
    { mode: "local", flags: ["--sync", "none"], sync: "none" },
  ])("makes no remote calls in $mode mode", async ({ flags, sync }) => {
    const runner = fakeGit();
    const result = await init(["--team", ...flags], runner);
    expect(result.code).toBe(0);
    expect(readFileSync(config(), "utf8")).toContain(`sync: ${sync}`);
    if (sync === "git") expect(result.json.warnings.join(" ")).toContain("init --upgrade --sync git");
    expect(runner.calls.every(([cmd]) => cmd === "rev-parse" || cmd === "remote")).toBe(true);
  });

  it("upgrades only sync and the generated index, then reuses the live ref", async () => {
    const remote = await setupOrigin();
    expect((await init(["--team", "--sync", "none"])).code).toBe(0);
    const original = `${readFileSync(config(), "utf8")}custom: retained # keep me\n`;
    writeFileSync(config(), original);
    const record = await cli(
      [
        "remember",
        "--title",
        "Keep this record",
        "--summary",
        "Keep it during upgrades.",
        "--body",
        "Body.",
        "--author",
        "human:test",
        "--json",
        "--dir",
        dir,
      ],
      { git },
    );
    expect(record.code).toBe(0);
    const path = join(dir, record.json.data.file);
    const body = readFileSync(path, "utf8");
    const upgrade = ["--upgrade", "--sync", "git"];
    const first = await init(upgrade);
    expect(first.code).toBe(0);
    expect(first.json.data.files).toEqual([".aimem/INDEX.md", ".aimem/project.yaml"]);
    expect(readFileSync(config(), "utf8")).toBe(original.replace("sync: none", "sync: git"));
    expect(readFileSync(path, "utf8")).toBe(body);
    expect(readFileSync(join(dir, ".aimem/INDEX.md"), "utf8")).toContain("sync: git");
    const tip = await sh(remote, "rev-parse", ref);
    const second = await init(upgrade);
    expect(second.code).toBe(0);
    expect(second.json.data.files).toEqual([]);
    const index = join(dir, ".aimem/INDEX.md");
    writeFileSync(index, readFileSync(index, "utf8").replace("sync: git", "sync: none"));
    const repair = await init(upgrade);
    expect(repair.code).toBe(0);
    expect(repair.json.data.files).toEqual([".aimem/INDEX.md"]);
    expect(await sh(remote, "rev-parse", ref)).toBe(tip);
  });

  it("reports an unreachable remote without exposing its path or creating a notebook", async () => {
    const remote = await setupOrigin();
    const missing = `${remote}.unreachable`;
    await sh(dir, "remote", "set-url", "origin", missing);
    const result = await init(["--team"]);
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe("SYNC_FAILED");
    expect(result.stdout).not.toContain("unreachable");
    expect(existsSync(config())).toBe(false);
  });

  it.each([
    { flags: ["--sync", "git"] },
    { flags: ["--team", "--sync", "server"] },
    { flags: ["--upgrade"] },
    { flags: ["--upgrade", "--sync", "git", "--force"] },
  ])("rejects invalid setup flags $flags", async ({ flags }) => {
    const result = await init(flags);
    expect(result.code).toBe(2);
    expect(result.json.error.code).toBe("USAGE");
  });

  it("rejects an upgrade of a solo notebook before any Git calls", async () => {
    const runner = fakeGit();
    expect((await init(["--solo"], runner)).code).toBe(0);
    const result = await init(["--upgrade", "--sync", "git"], runner);
    expect(result.code).toBe(2);
    expect(result.json.error.code).toBe("USAGE");
    expect(runner.calls).toEqual([]);
  });

  it("validates adapter options before creating the live ref", async () => {
    const remote = await setupOrigin();
    const result = await init(["--team", "--adapters", "invalid"]);
    expect(result.code).toBe(2);
    expect(await sh(remote, "for-each-ref", "--format=%(refname)")).toBe("");
    expect(existsSync(config())).toBe(false);
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
