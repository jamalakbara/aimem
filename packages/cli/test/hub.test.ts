import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaGit } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
let root: string;
let env: Record<string, string>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-hub-"));
  env = { AIMEM_HOME: join(root, "cache"), AIMEM_AUTHOR: "human:dana" };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("aimem hub init (04 §2, M3.6b)", () => {
  it("creates a hub notebook and prints the member snippet", async () => {
    const hubDir = join(root, "acme-hub");
    mkdirSync(hubDir);
    await git.run(["init", "-q"], hubDir);
    await git.run(["remote", "add", "origin", "git@example.invalid:acme/acme-hub.git"], hubDir);
    const r = await cli(
      [
        "hub",
        "init",
        "--project",
        "acme",
        "--repos",
        "api,web",
        "--adapters",
        "none",
        "--json",
        "--dir",
        hubDir,
      ],
      { git, env },
    );
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({
      project: "acme",
      scope: "hub",
      repos: ["api", "web"],
      snippet: "hub:\n  url: git@example.invalid:acme/acme-hub.git",
    });
    const yaml = readFileSync(join(hubDir, ".aimem/project.yaml"), "utf8");
    expect(yaml).toContain("scope: hub");
    expect(yaml).toMatch(/repos:\n\s+- name: api\n\s+- name: web/);
    expect(readFileSync(join(hubDir, ".aimem/INDEX.md"), "utf8")).toContain("scope: hub");

    // A member repo using the snippet resolves the hub beside it.
    const api = join(root, "api");
    mkdirSync(api);
    expect((await cli(["init", "--project", "acme", "--adapters", "none", "--dir", api], { env })).code).toBe(
      0,
    );
    const cfg = join(api, ".aimem/project.yaml");
    writeFileSync(cfg, `${readFileSync(cfg, "utf8")}repo: api\n${r.json.data.snippet}\n`);
    const s = await cli(["status", "--json", "--dir", api], { env });
    expect(s.json.data.sources).toEqual([
      { name: "local", kind: "local", status: "ok", records: 0 },
      { name: "hub", kind: "hub", status: "ok", records: 0 },
    ]);
  });

  it("warns when the hub has no origin and rejects an empty repo list", async () => {
    const dir = join(root, "plain");
    mkdirSync(dir);
    const r = await cli(["hub", "init", "--adapters", "none", "--json", "--dir", dir], { git, env });
    expect(r.json.data.snippet).toBe("hub:\n  url: <url of this hub repo>");
    expect(r.json.warnings).toContain("No origin remote: replace the hub url placeholder in the snippet.");
    const bad = await cli(["hub", "init", "--repos", " , ", "--json", "--dir", join(root, "x")], { env });
    expect(bad.json.error.code).toBe("USAGE");
  });
});

describe("validate --project (03 §7 rule 6)", () => {
  const copy = () => {
    cpSync(join(FIXTURES, "multirepo"), join(root, "p"), { recursive: true });
    return join(root, "p", "backend");
  };

  it("reports IDs duplicated across notebooks and names unread sources", async () => {
    const backend = copy();
    expect((await cli(["validate", "--json", "--dir", backend], { env })).code).toBe(0);
    const r = await cli(["validate", "--project", "--json", "--dir", backend], { env });
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("INVALID_RECORD");
    expect(r.json.error.details.unchecked).toEqual(["repo:infra"]);
    expect(r.json.error.details.issues).toEqual([
      expect.objectContaining({
        code: "V005",
        ref: "mem-qmrpmxdn",
        message: expect.stringContaining("local and repo:frontend"),
      }),
    ]);
  });

  it("flags an unknown project-qualified ref once every source was read", async () => {
    const backend = copy();
    const p = join(root, "p");
    cpSync(join(p, "shop-hub"), join(p, "infra"), { recursive: true });
    writeFileSync(
      join(p, "infra/.aimem/project.yaml"),
      readFileSync(join(p, "infra/.aimem/project.yaml"), "utf8").replace("scope: hub", "repo: infra"),
    );
    rmSync(join(p, "infra/.aimem/decisions"), { recursive: true });
    rmSync(join(p, "infra/.aimem/tasks"), { recursive: true });
    const mem = join(backend, ".aimem/memory");
    const file = readFileSync(join(mem, "mem-qmrpmxdn-payment-webhooks-arrive-twice.md"), "utf8");
    writeFileSync(
      join(mem, "mem-qmrpmxdn-payment-webhooks-arrive-twice.md"),
      file.replace("acme-shop:dec-t1a73qsk", "acme-shop:dec-zzzzzzzz"),
    );
    const r = await cli(["validate", "--project", "--json", "--dir", backend], { env });
    expect(r.json.error.details.unchecked).toEqual([]);
    expect(r.json.error.details.issues.map((i: { code: string }) => i.code).sort()).toEqual(["V005", "V006"]);
  });
});
