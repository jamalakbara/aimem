import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-regular-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const read = (name: string, max = 100) =>
  nodeFs.readRegular?.(join(dir, name), max).then(
    (text): { text?: string; code?: string | undefined } => ({ text }),
    (e: { code?: string }) => ({ code: e.code }),
  );

it("reads regular files up to the limit, also empty and multi-byte ones", async () => {
  writeFileSync(join(dir, "a"), "é".repeat(50));
  expect(await read("a")).toEqual({ text: "é".repeat(50) });
  writeFileSync(join(dir, "b"), "");
  expect(await read("b")).toEqual({ text: "" });
  appendFileSync(join(dir, "a"), "x");
  expect(await read("a")).toEqual({ code: "EFBIG" });
  expect(await read("none")).toEqual({ code: "ENOENT" });
});

it("refuses folders", async () => {
  mkdirSync(join(dir, "d"));
  expect((await read("d"))?.code).toMatch(/^(ENOTREG|EISDIR|EPERM|EACCES)$/);
});

it.skipIf(process.platform === "win32")("refuses links, FIFOs and devices without waiting", async () => {
  writeFileSync(join(dir, "a"), "x");
  symlinkSync(join(dir, "a"), join(dir, "l"));
  expect((await read("l"))?.code).toMatch(/^(ELOOP|EMLINK)$/);
  execFileSync("mkfifo", [join(dir, "f")]);
  expect(await read("f")).toEqual({ code: "ENOTREG" });
  expect(await nodeFs.readRegular?.("/dev/zero", 10).catch((e) => e.code)).toBe("ENOTREG");
});
