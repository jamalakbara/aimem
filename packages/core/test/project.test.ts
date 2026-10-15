import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AimemError, findNotebook, loadProject, nodeFs } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-project-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeProject(yaml: string): void {
  mkdirSync(join(dir, ".aimem"), { recursive: true });
  writeFileSync(join(dir, ".aimem/project.yaml"), yaml);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "no error";
  } catch (e) {
    expect(e).toBeInstanceOf(AimemError);
    return (e as AimemError).code;
  }
}

describe("findNotebook", () => {
  it("walks up from a nested directory to the folder containing .aimem/project.yaml", async () => {
    writeProject("aimem: 1\nproject: demo\n");
    mkdirSync(join(dir, "src/deep/er"), { recursive: true });
    expect(await findNotebook(nodeFs, join(dir, "src/deep/er"))).toBe(dir);
  });
  it("returns null when there is no notebook", async () => {
    expect(await findNotebook(nodeFs, dir)).toBeNull();
  });
});

describe("loadProject", () => {
  it("loads a fixture and applies defaults for missing keys", async () => {
    const nb = await loadProject(nodeFs, join(FIXTURES, "tiny/.aimem/decisions"));
    expect(nb.root).toBe(join(FIXTURES, "tiny"));
    expect(nb.dir).toBe(join(FIXTURES, "tiny/.aimem"));
    expect(nb.config.project).toBe("acme-ledger");
    expect(nb.config.freshness_days).toEqual({ memory: 90, runbook: 180, schema: 120 });
    expect(nb.config.roles).toEqual(["dev", "pm", "qa", "db", "devops", "analyst"]);
  });

  it("keeps explicit values over defaults", async () => {
    writeProject("aimem: 1\nproject: demo\nroles: [dev]\nfreshness_days: { memory: 30 }\n");
    const nb = await loadProject(nodeFs, dir);
    expect(nb.config.roles).toEqual(["dev"]);
    expect(nb.config.freshness_days).toEqual({ memory: 30, runbook: 180, schema: 120 });
  });

  it.each([
    ["no notebook", null, "NOT_INITIALIZED"],
    ["invalid YAML", "aimem: 1\nproject: [demo\n", "INVALID_RECORD"],
    ["schema violation", "aimem: 1\nproject: Not A Slug\n", "INVALID_RECORD"],
    ["newer spec", "aimem: 2\nproject: demo\n", "SPEC_TOO_NEW"],
  ])("fails with a stable code for %s", async (_name, yaml, code) => {
    if (yaml !== null) writeProject(yaml);
    expect(await codeOf(loadProject(nodeFs, dir))).toBe(code);
  });
});
