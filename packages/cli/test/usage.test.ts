import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-usage-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
it("records explicit usage without committing, embedding, generating or updating INDEX", async () => {
  const git = fakeGit();
  const baseline = await cli(["search", "money", "--mode", "lexical", "--dir", dir, "--json"]);
  const r = await cli(
    [
      "usage",
      "record",
      "--session",
      "opaque01",
      "--refs",
      "dec-1a2b3c4d,mem-5e6f7g8h",
      "--dir",
      dir,
      "--json",
    ],
    { git },
  );
  expect(r.code).toBe(0);
  expect(r.json.data).toMatchObject({
    recorded: true,
    file: ".aimem/.cache/usage.jsonl",
    entry: { source: "agent", session: "opaque01", refs: ["dec-1a2b3c4d", "mem-5e6f7g8h"] },
  });
  expect(git.calls).toEqual([]);
  expect((await cli(["search", "money", "--mode", "lexical", "--dir", dir, "--json"])).json.data).toEqual(
    baseline.json.data,
  );
  expect(readFileSync(join(dir, ".aimem/.cache/usage.jsonl"), "utf8")).not.toContain("summary");
});

it("new notebooks ignore the disposable usage cache", async () => {
  const fresh = join(dir, "fresh");
  mkdirSync(fresh);
  const result = await cli(["init", "--solo", "--dir", fresh, "--json"], { git: fakeGit("test") });
  expect(result.code).toBe(0);
  expect(readFileSync(join(fresh, ".gitignore"), "utf8")).toContain(".aimem/.cache/");
});
it.each([
  ["--session", "../escape", "--refs", "dec-1a2b3c4d"],
  ["--session", "s1", "--refs", "invalid"],
])("returns USAGE exit 2 for invalid input %j", async (args) => {
  const result = await cli(["usage", "record", ...args, "--dir", dir, "--json"]);
  expect(result.code).toBe(2);
  expect(result.json.error.code).toBe("USAGE");
});
it("returns NOT_FOUND for unknown refs and PERMISSION_DENIED for unavailable storage", async () => {
  const args = ["usage", "record", "--session", "s1", "--dir", dir, "--json"];
  const unknown = await cli([...args, "--refs", "dec-00000000"]);
  expect(unknown.json.error.code).toBe("NOT_FOUND");
  const result = await cli([...args, "--refs", "dec-1a2b3c4d"], {
    fs: {
      ...nodeFs,
      appendFile: async () => {
        throw new Error("raw private message");
      },
    },
  });
  expect(result.code).toBe(2);
  expect(result.json.error.code).toBe("PERMISSION_DENIED");
  expect(result.stdout).not.toContain("raw private message");
});
