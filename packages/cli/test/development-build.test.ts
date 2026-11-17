import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { nodeFs } from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-build-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "aimem-monorepo", private: true }));
  for (const path of [
    "packages/cli/src",
    "packages/cli/dist",
    "packages/core/src/nested",
    "packages/core/dist/nested",
  ])
    mkdirSync(join(dir, path), { recursive: true });
  for (const path of [
    "packages/cli/src/bin.ts",
    "packages/cli/dist/bin.js",
    "packages/core/src/nested/note.ts",
    "packages/core/dist/nested/note.js",
  ])
    writeFileSync(join(dir, path), "example");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function diagnose(stale: boolean, missing = false) {
  return cli(["doctor", "--dir", dir, "--json"], {
    cliEntry: join(dir, "packages/cli/dist/bin.js"),
    fs: {
      ...nodeFs,
      stat: async (path) => {
        const result = await nodeFs.stat?.(path);
        if (!result) throw new Error("stat unavailable");
        const rel = relative(dir, path).replaceAll("\\", "/");
        if (missing && rel === "packages/core/dist/nested/note.js")
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return { ...result, mtimeMs: !result.isDirectory && rel.endsWith(".ts") ? (stale ? 20 : 5) : 10 };
      },
    },
  });
}

it("warns when a linked build predates any dependency source, retaining exit 0", async () => {
  const result = await diagnose(true);
  expect(result.code).toBe(0);
  expect(result.json.data.checks).toContainEqual(
    expect.objectContaining({
      name: "development build",
      status: "warn",
      detail: expect.stringContaining("run pnpm build"),
    }),
  );
});
it("reports fresh development output and missing compiled files", async () => {
  expect((await diagnose(false)).json.data.checks).toContainEqual(
    expect.objectContaining({ name: "development build", status: "ok" }),
  );
  expect((await diagnose(false, true)).json.data.checks).toContainEqual(
    expect.objectContaining({ name: "development build", status: "warn" }),
  );
});
it("skips normal installed packages and keeps legacy injected filesystems usable", async () => {
  const installed = await cli(["doctor", "--dir", dir, "--json"], {
    cliEntry: join(dir, "node_modules/aimem/dist/bin.js"),
  });
  expect(installed.json.data.checks.some((c: { name: string }) => c.name === "development build")).toBe(
    false,
  );
  const unsupported = await cli(["doctor", "--dir", dir, "--json"], {
    cliEntry: join(dir, "packages/cli/dist/bin.js"),
    fs: { ...nodeFs, stat: undefined },
  });
  expect(unsupported.code).toBe(0);
  expect(unsupported.json.data.checks).toContainEqual(
    expect.objectContaining({ name: "development build", status: "info" }),
  );
});

it("keeps doctor successful when source metadata is unreadable", async () => {
  const result = await cli(["doctor", "--dir", dir, "--json"], {
    cliEntry: join(dir, "packages/cli/dist/bin.js"),
    fs: {
      ...nodeFs,
      stat: async () => {
        throw new Error("private local filesystem detail");
      },
    },
  });
  expect(result.code).toBe(0);
  expect(result.json.data.checks).toContainEqual(
    expect.objectContaining({ name: "development build", status: "info" }),
  );
  expect(result.stdout).not.toContain("private local filesystem detail");
});
