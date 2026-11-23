import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
const random = cryptoRandom;
const human = { AIMEM_AUTHOR: "human:dana" };
const agent = { AIMEM_AUTHOR: "agent:claude-code" };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-review-"));
  cpSync(join(FIXTURES, "adopt-me"), dir, { recursive: true });
  // Three ADR drafts; "Store scans as events" is superseded, so two are in the queue.
  const r = await cli(["adopt", "--sources", "adr", "--json", "--dir", dir], { env: agent, random });
  expect(r.code).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const script = (answers: string[]) => {
  const asked: string[] = [];
  return {
    asked,
    prompt: async (q: string) => {
      asked.push(q);
      return answers.shift();
    },
  };
};
const queue = async () => (await cli(["review", "--json", "--dir", dir], { env: agent, random })).json.data;

describe("aimem review (M4.5)", () => {
  it("--json lists the queue and changes nothing, for agents too", async () => {
    const q = await queue();
    expect(q.counts).toEqual({ inferred: 2, unreviewed: 0, stale: 0, duplicate: 0 });
    expect(q.queue.map((i: { title: string }) => i.title)).toEqual([
      "Fold scans in a worker",
      "Use Postgres for parcel state",
    ]);
    expect(q.queue[0]).toMatchObject({
      trust: "inferred",
      reasons: ["inferred"],
      evidence: [expect.any(String)],
    });
  });

  it("--limit shows the first N items and the total (M4 gap)", async () => {
    const r = await cli(["review", "--limit", "1", "--json", "--dir", dir], { env: agent, random });
    expect(r.json.data.queue).toHaveLength(1);
    expect(r.json.data.total).toBe(2);
    const t = await cli(["review", "--limit", "1", "--dir", dir], { env: human, random });
    expect(t.stdout).toMatch(/^2 records need review \(showing 1; --limit\):/);
  });

  it("walks the queue: verify, discard, and a summary at the end", async () => {
    const [fold, pg] = (await queue()).queue;
    const s = script(["v", "d"]);
    const r = await cli(["review", "--dir", dir], { env: human, random, prompt: s.prompt });
    expect(r.code).toBe(0);
    expect(s.asked).toHaveLength(2);
    expect(s.asked[0]).toMatch(/\(v\)erify {2}\(e\)dit\+verify {2}\(s\)kip {2}\(d\)iscard {2}\(q\)uit/);
    expect(r.stdout).toMatch(/\[1\/2\] .+ decision {2}accepted {2}inferred {2}Fold scans in a worker/);
    expect(r.stdout).toMatch(/evidence: docs\/adr\/0003-fold-scans-in-a-worker\.md/);
    expect(r.stdout).toMatch(/Reviewed 2 of 2: 1 verified, 1 discarded, 0 skipped\.\n$/);
    expect(readFileSync(join(dir, fold.file), "utf8")).toMatch(/trust: verified/);
    expect(existsSync(join(dir, pg.file))).toBe(false);
    expect((await queue()).queue).toEqual([]);
  });

  it("e opens the editor, then verifies the edited record; q stops", async () => {
    const [fold] = (await queue()).queue;
    const edited: string[] = [];
    const r = await cli(["review", "--dir", dir], {
      env: human,
      random,
      prompt: script(["e", "q"]).prompt,
      edit: async (file: string) => {
        edited.push(file);
        appendFileSync(file, "\nChecked against the worker code.\n");
      },
    });
    expect(r.code).toBe(0);
    expect(edited).toEqual([join(dir, fold.file)]);
    const text = readFileSync(join(dir, fold.file), "utf8");
    expect(text).toMatch(/trust: verified/);
    expect(text).toMatch(/Checked against the worker code\./);
    expect(r.stdout).toMatch(/Reviewed 1 of 2: 1 verified, 0 discarded, 0 skipped\./);
  });

  it("an editor that fails leaves the record unverified and the walk goes on (QA 15)", async () => {
    const [fold] = (await queue()).queue;
    const r = await cli(["review", "--dir", dir], {
      env: human,
      random,
      prompt: script(["e", "s"]).prompt,
      edit: async () => {
        throw new Error("editor vi exited with 1");
      },
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/editor failed \(editor vi exited with 1\); not verified/);
    expect(readFileSync(join(dir, fold.file), "utf8")).toMatch(/trust: inferred/);
    expect(r.stdout).toMatch(/Reviewed 2 of 2: 0 verified, 0 discarded, 2 skipped\./);
  });

  it("an edit that breaks the record is undone and nothing is verified (QA #90/#91 finding 1)", async () => {
    const [fold] = (await queue()).queue;
    const path = join(dir, fold.file);
    const before = readFileSync(path, "utf8");
    const r = await cli(["review", "--dir", dir], {
      env: human,
      random,
      prompt: script(["e", "q"]).prompt,
      edit: async (file: string) => writeFileSync(file, "---\nbroken: [\n---\nbody\n"),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/the edit left an invalid record; restored the original, not verified/);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect((await cli(["validate", "--strict", "--dir", dir], { env: human, random })).code).toBe(0);
  });

  it("an unknown key asks again (QA finding 2)", async () => {
    const s = script(["x", "s", "q"]);
    const r = await cli(["review", "--dir", dir], { env: human, random, prompt: s.prompt });
    expect(s.asked).toHaveLength(3);
    expect(r.stdout).toMatch(/unknown answer 'x'; use v, e, s, d or q/);
    expect(r.stdout).toMatch(/Reviewed 1 of 2: 0 verified, 0 discarded, 1 skipped\./);
  });

  it("an agent may skip but not verify or discard; each refusal is shown and the walk goes on", async () => {
    const r = await cli(["review", "--dir", dir], { env: agent, random, prompt: script(["v", "d"]).prompt });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/only a human can verify records/);
    expect(r.stdout).toMatch(/only a human can discard records/);
    expect(r.stdout).toMatch(/Reviewed 2 of 2: 0 verified, 0 discarded, 2 skipped\./);
    expect((await queue()).queue).toHaveLength(2);
  });

  it("without a terminal it prints the queue and the commands to use", async () => {
    const r = await cli(["review", "--dir", dir], { env: human, random });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^2 records need review:/);
    expect(r.stdout).toMatch(/aimem verify <ref>.*aimem discard <ref>/s);
  });
});

describe("aimem discard (M4.5)", () => {
  it("deletes a never-verified draft for a human, and refuses an agent", async () => {
    const [, pg] = (await queue()).queue;
    const no = await cli(["discard", pg.ref, "--json", "--dir", dir], { env: agent, random });
    expect(no.code).toBe(2);
    expect(no.json.error.code).toBe("PERMISSION_DENIED");
    const ok = await cli(["discard", pg.ref, "--json", "--dir", dir], { env: human, random });
    expect(ok.code).toBe(0);
    expect(ok.json.data).toMatchObject({
      ref: pg.ref,
      changed: [pg.file, ".aimem/adopt-discarded", ".aimem/INDEX.md"],
    });
    expect(existsSync(join(dir, pg.file))).toBe(false);
  });
});
