import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { protocolBlock } from "@aimem/adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-adapters-"));
  mkdirSync(join(dir, ".aimem"));
  writeFileSync(
    join(dir, ".aimem/project.yaml"),
    "aimem: 1\nproject: demo\n# keep this comment\nroles: [dev, qa]\n",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const run = (args: string[]) => cli([...args, "--dir", dir]);

describe("aimem adapters", () => {
  it("sync writes the default target and records it (contract); a second sync changes nothing", async () => {
    const r = await run(["adapters", "sync", "--json"]);
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/adapters-sync.json",
    );
    expect(read("AGENTS.md")).toBe(`${protocolBlock()}\n`);
    const again = await run(["adapters", "sync", "--json"]);
    expect(again.json.data.results).toEqual([{ target: "agents", file: "AGENTS.md", action: "unchanged" }]);
  });

  it("--targets selects tools and is remembered in project.yaml, keeping comments", async () => {
    await run(["adapters", "sync", "--targets", "agents,cursor", "--json"]);
    expect(read(".aimem/project.yaml")).toBe(
      "aimem: 1\nproject: demo\n# keep this comment\nroles: [dev, qa]\nadapters:\n  targets: [agents, cursor]\n",
    );
    const list = await run(["adapters", "list", "--json"]);
    await expect(`${JSON.stringify(list.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/adapters-list.json",
    );
  });

  it("add --file records a custom file and writes the block there", async () => {
    const r = await run(["adapters", "add", "--file", "docs/AI.md", "--json"]);
    expect(r.json.data.results).toEqual([{ target: "file", file: "docs/AI.md", action: "created" }]);
    expect(read(".aimem/project.yaml")).toContain("files: [docs/AI.md]");
  });

  it("remove takes every block out and restores files exactly (contract)", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "# Rules\nNo force pushes.");
    await run(["adapters", "sync", "--targets", "agents,gemini"]);
    const r = await run(["adapters", "remove", "--json"]);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/adapters-remove.json",
    );
    expect(read("AGENTS.md")).toBe("# Rules\nNo force pushes.");
    expect(existsSync(join(dir, "GEMINI.md"))).toBe(false);
    expect(read(".aimem/project.yaml")).toContain("targets: []");
  });

  it("a broken block fails with exit 2 and leaves the file alone", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "<!-- aimem:begin v1 -->\nhalf\n");
    const r = await run(["adapters", "sync", "--json"]);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("USAGE");
    expect(r.json.error.details.results[0]).toMatchObject({ action: "broken" });
    expect(read("AGENTS.md")).toBe("<!-- aimem:begin v1 -->\nhalf\n");
  });

  it.each([[["adapters", "dance"]], [["adapters", "sync", "--targets", "vscode"]], [["adapters", "add"]]])(
    "%j → USAGE",
    async (args) => {
      const r = await run([...args, "--json"]);
      expect(r.code).toBe(2);
      expect(r.json.error.code).toBe("USAGE");
    },
  );
});
