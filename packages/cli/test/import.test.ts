import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

const IMPORTS = join(FIXTURES, "../imports");
let dir: string;
const random = cryptoRandom;
const human = { AIMEM_AUTHOR: "human:dana" };
const agent = { AIMEM_AUTHOR: "agent:claude-code" };
const VISIBLE = "Imported content is visible to everyone who can read this repository";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-import-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  cpSync(IMPORTS, join(dir, "docs"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const imp = (file: string, env = human, extra: Record<string, unknown> = {}) =>
  cli(["import", join(dir, "docs", file), "--json", "--dir", dir], { env, random, ...extra });
const externalFiles = () =>
  ["decisions", "memory", "runbooks", "incidents"].flatMap((d) => {
    let names: string[];
    try {
      names = readdirSync(join(dir, ".aimem", d));
    } catch {
      return [];
    }
    return names.filter((f) =>
      readFileSync(join(dir, ".aimem", d, f), "utf8").includes("managed_by: external"),
    );
  });

describe("aimem import (M4b.1)", () => {
  it("imports a decision template once, then reports unchanged, then updates in place", async () => {
    const a = await imp("decision.md");
    expect(a.code).toBe(0);
    expect(a.json.data).toMatchObject({
      action: "created",
      type: "decision",
      title: "Store parcel events for 90 days",
      trust: "verified",
      mode: "template",
      source: { system: "upload", id: "docs/decision.md" },
    });
    expect(a.json.warnings).toContain(VISIBLE);
    const b = await imp("decision.md");
    expect(b.json.data).toMatchObject({ action: "unchanged", ref: a.json.data.ref });
    const path = join(dir, "docs/decision.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("every night", "every Sunday"));
    const c = await imp("decision.md");
    expect(c.json.data).toMatchObject({ action: "updated", ref: a.json.data.ref });
    expect(externalFiles()).toHaveLength(1);
    expect((await cli(["validate", "--strict", "--dir", dir], { env: human, random })).code).toBe(0);
  });

  it("imports a free text file as a whole-document reference memory, with the reason", async () => {
    const r = await imp("notes.txt");
    expect(r.json.data).toMatchObject({ type: "memory", mode: "whole-document" });
    expect(r.json.warnings).toContain("no template matched; imported as a whole document");
  });

  it("refuses formats of later slices, and files with a likely secret", async () => {
    writeFileSync(join(dir, "docs/spec.docx"), "PK");
    const d = await imp("spec.docx");
    expect(d.code).toBe(2);
    expect(d.json.error.message).toMatch(
      /\.docx files arrive in a later M4b slice; this version imports \.md and \.txt/,
    );
    const key = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    writeFileSync(join(dir, "docs/leak.md"), `# Leak\n\n## Summary\n\nKey ${key} here.\n`);
    const s = await imp("leak.md");
    expect(s.json.error.code).toBe("SECRET_DETECTED");
    expect(JSON.stringify(s.json)).not.toContain(key);
    expect(externalFiles()).toEqual([]);
  });

  it("an agent import is one commit and trust agent", async () => {
    const git = fakeGit(undefined, "feature/import");
    const r = await imp("runbook.md", agent, { git });
    expect(r.json.data).toMatchObject({ type: "runbook", trust: "agent", git: "committed" });
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });
});

describe("aimem detach and edit-at-source refusals (M4b.1)", () => {
  it("update is refused with an edit-at-source message until the record is detached", async () => {
    const { ref } = (await imp("decision.md")).json.data;
    const no = await cli(["update", ref, "--set", "status=rejected", "--json", "--dir", dir], {
      env: human,
      random,
    });
    expect(no.json.error.code).toBe("READONLY_EXTERNAL");
    expect(no.json.error.message).toMatch(/edit it (at|there)/);
    const d = await cli(["detach", ref, "--json", "--dir", dir], { env: human, random });
    expect(d.code).toBe(0);
    expect(d.stdout).toBeTruthy();
    const ok = await cli(["update", ref, "--set", "status=rejected", "--json", "--dir", dir], {
      env: human,
      random,
    });
    expect(ok.code).toBe(0);
  });

  it("review refuses to open an imported record in the editor", async () => {
    const { ref } = (await imp("runbook.md", agent)).json.data;
    const queue = (await cli(["review", "--json", "--dir", dir], { env: human, random })).json.data.queue;
    const at = queue.findIndex((i: { ref: string }) => i.ref === ref);
    expect(at).toBeGreaterThanOrEqual(0);
    const asked: string[] = [];
    const answers = [...Array(at).fill("s"), "e", "q"];
    let edited = false;
    const r = await cli(["review", "--dir", dir], {
      env: human,
      random,
      prompt: async (q: string) => {
        asked.push(q);
        return answers.shift();
      },
      edit: async () => {
        edited = true;
      },
    });
    expect(edited).toBe(false);
    expect(r.stdout).toMatch(/is owned by upload; edit it at the source/);
  });
});
