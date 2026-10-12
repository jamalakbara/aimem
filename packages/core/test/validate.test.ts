import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  exitCodeFor,
  type Issue,
  loadProject,
  nodeFs,
  type ResolvedProject,
  type ValidationInput,
  validateFiles,
  validateNotebook,
} from "@aimem/core";
import type { RecordType } from "@aimem/schema";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { FIXTURES, read } from "./helpers.js";

const CLOCK = { now: () => new Date("2026-10-12T00:00:00Z") };

function byFile(issues: Issue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of issues) out[i.file] = [...new Set([...(out[i.file] ?? []), i.code])].sort();
  return out;
}

describe("fixtures (the 1.2 contract)", () => {
  it.each(["messy", "medium"])("%s produces exactly the codes in expected.yaml", async (name) => {
    const nb = await loadProject(nodeFs, join(FIXTURES, name));
    const issues = await validateNotebook(nb, { fs: nodeFs, clock: CLOCK });
    const manifest = YAML.parse(read(join(FIXTURES, name, "expected.yaml"))) as {
      files: Record<string, string[]>;
    };
    const expected = Object.fromEntries(
      Object.entries(manifest.files)
        .filter(([, c]) => c.length)
        .map(([f, c]) => [f, [...c].sort()]),
    );
    expect(byFile(issues)).toEqual(expected);
  });

  it("tiny is completely clean", async () => {
    const nb = await loadProject(nodeFs, join(FIXTURES, "tiny"));
    expect(await validateNotebook(nb, { fs: nodeFs, clock: CLOCK })).toEqual([]);
  });

  it("reports V008 by line number without the secret", async () => {
    const nb = await loadProject(nodeFs, join(FIXTURES, "messy"));
    const v008 = (await validateNotebook(nb, { fs: nodeFs, clock: CLOCK })).filter((i) => i.code === "V008");
    expect(v008).toHaveLength(1);
    expect(v008[0]?.line).toBeGreaterThan(1);
    expect(JSON.stringify(v008)).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });
});

// ---- per-code unit tests ---------------------------------------------------------------

const config: ResolvedProject = {
  aimem: 1,
  project: "demo",
  mode: "solo",
  sync: "none",
  roles: ["dev", "qa"],
  freshness_days: { memory: 90, runbook: 180, schema: 120 },
};

const DIR: Record<RecordType, string> = {
  decision: "decisions",
  task: "tasks",
  memory: "memory",
  handoff: "handoffs",
  incident: "incidents",
  runbook: "runbooks",
  schema: "schema",
  testcase: "tests",
};
const HANDOFF_BODY =
  "## Done\nx\n\n## Not done\nx\n\n## Next\nx\n\n## Blocked\nnone\n\n## Notes for next agent\nnone";

interface Spec {
  id: string;
  type?: RecordType;
  dir?: RecordType;
  name?: string;
  fm?: Record<string, unknown>;
  drop?: string[];
  body?: string;
}

function file(s: Spec): ValidationInput {
  const type = s.type ?? "memory";
  const fm: Record<string, unknown> = {
    aimem: 1,
    id: s.id,
    type,
    title: `Title of ${s.id}`,
    summary: `Summary of ${s.id}.`,
    status:
      { decision: "accepted", task: "open", memory: "active", handoff: "final" }[type as string] ?? "active",
    trust: "agent",
    roles: ["dev"],
    author: "agent:test",
    created: "2026-10-01T09:00:00Z",
    updated: "2026-10-01T09:00:00Z",
    ...s.fm,
  };
  for (const k of s.drop ?? []) delete fm[k];
  const body = s.body ?? (type === "handoff" ? HANDOFF_BODY : "A short body.");
  const text = `---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n\n${body}\n`;
  return { file: `.aimem/${DIR[s.dir ?? type]}/${s.name ?? `${s.id}-x.md`}`, dirType: s.dir ?? type, text };
}

function codes(inputs: ValidationInput[]): Record<string, string[]> {
  return byFile(validateFiles(inputs, config, CLOCK.now()));
}

const M = (n: number) => `mem-0000000${n}`;
const D = (n: number) => `dec-0000000${n}`;

describe("one positive and one near-miss per rule", () => {
  const sha = (body: string) => createHash("sha256").update(body).digest("hex");
  const src = (body: string, state = "ok") => ({
    managed_by: "external",
    source: {
      system: "google-doc",
      id: "d1",
      url: "https://docs.example.com/d1",
      version: 1,
      content_sha: sha(body),
      synced_at: "2026-10-01T09:00:00Z",
      imported_by: "human:x",
      state,
    },
  });

  const cases: [string, ValidationInput[], ValidationInput[]][] = [
    [
      "V001",
      [{ file: ".aimem/memory/mem-00000001-x.md", dirType: "memory", text: "no frontmatter\n" }],
      [file({ id: M(1) })],
    ],
    ["V002", [file({ id: M(1), drop: ["summary"] })], [file({ id: M(1), fm: { kind: "gotcha" } })]],
    ["V003", [file({ id: D(1), type: "decision", dir: "memory" })], [file({ id: D(1), type: "decision" })]],
    [
      "V004",
      [file({ id: D(1), type: "decision", fm: { status: "done" } })],
      [file({ id: D(1), type: "decision", fm: { status: "proposed" } })],
    ],
    [
      "V005",
      [file({ id: M(1), name: "mem-00000001-a.md" }), file({ id: M(1), name: "mem-00000001-b.md" })],
      [file({ id: M(1) }), file({ id: M(2) })],
    ],
    [
      "V006",
      [file({ id: M(1), fm: { links: [M(9)] } })],
      [file({ id: M(1), fm: { links: [M(2), "other-project:mem-00000009"] } }), file({ id: M(2) })],
    ],
    [
      "V007",
      [file({ id: D(1), type: "decision", fm: { supersedes: D(2) } }), file({ id: D(2), type: "decision" })],
      [
        file({ id: D(1), type: "decision", fm: { supersedes: D(2) } }),
        file({ id: D(2), type: "decision", fm: { status: "superseded", superseded_by: D(1) } }),
      ],
    ],
    [
      "V008",
      [file({ id: M(1), body: ["password = ", "hunter2hunter2hunter2"].join("") })],
      [file({ id: M(1), body: "The password policy is documented elsewhere." })],
    ],
    [
      "V009",
      [file({ id: M(1), fm: { summary: "Title of mem-00000001" } })],
      [file({ id: M(1), fm: { summary: "x".repeat(200) } })],
    ],
    [
      "V010",
      [file({ id: M(1), fm: { created: "2026-06-01T00:00:00Z" } })],
      [file({ id: M(1), fm: { created: "2026-06-01T00:00:00Z", verified: "2026-10-01" } })],
    ],
    [
      "V011",
      [
        file({ id: D(1), type: "decision", fm: { tags: ["db"], paths: ["db/**"] } }),
        file({ id: D(2), type: "decision", fm: { tags: ["db"], paths: ["db/migrations/**"] } }),
      ],
      [
        file({ id: D(1), type: "decision", fm: { tags: ["db"], paths: ["db/**"], links: [D(2)] } }),
        file({ id: D(2), type: "decision", fm: { tags: ["db"], paths: ["db/migrations/**"] } }),
      ],
    ],
    [
      "V012",
      [file({ id: "hnd-00000001", type: "handoff", body: "## Done\nx\n\n## Next\nx" })],
      [file({ id: "hnd-00000001", type: "handoff" })],
    ],
    [
      "V013",
      [file({ id: M(1), body: "word ".repeat(601) })],
      [file({ id: M(1), body: "word ".repeat(600) })],
    ],
    [
      "V014",
      [file({ id: M(1), fm: { roles: ["dev", "astronaut"] } })],
      [file({ id: M(1), fm: { roles: ["all"] } })],
    ],
    [
      "V015",
      [file({ id: M(1), name: "renamed.md" })],
      [file({ id: M(1), name: "mem-00000001-a-different-slug.md" })],
    ],
    ["V016", [file({ id: M(1), fm: { aimem: 2 } })], [file({ id: M(1), fm: { aimem: 1 } })]],
    [
      "V017",
      [file({ id: D(1), type: "decision", body: "edited locally", fm: src("original") })],
      [file({ id: D(1), type: "decision", body: "original", fm: src("original") })],
    ],
    [
      "V018",
      [file({ id: D(1), type: "decision", body: "b", fm: src("b", "missing") })],
      [file({ id: D(1), type: "decision", body: "b", fm: src("b") })],
    ],
  ];

  it.each(cases)("%s", (code, positive, nearMiss) => {
    const pos = Object.values(codes(positive)).flat();
    expect(pos, "positive").toContain(code);
    expect(Object.values(codes(nearMiss)).flat(), "near miss").toEqual([]);
  });

  it("V011 is reported on both decisions", () => {
    const [a, b] = cases.find(([c]) => c === "V011")?.[1] ?? [];
    expect(codes([a as ValidationInput, b as ValidationInput])).toEqual({
      [a?.file as string]: ["V011"],
      [b?.file as string]: ["V011"],
    });
  });

  it("V010 is not reported for superseded records", () => {
    const old = file({
      id: M(1),
      fm: { created: "2026-01-01T00:00:00Z", status: "superseded", superseded_by: M(2) },
    });
    const next = file({ id: M(2), fm: { supersedes: M(1) } });
    expect(codes([old, next])).toEqual({});
  });

  it("V010 also fires for an expired record of a type without a freshness window", () => {
    expect(
      Object.values(codes([file({ id: D(1), type: "decision", fm: { expires: "2026-10-01" } })])).flat(),
    ).toEqual(["V010"]);
  });

  it("refs to the own project via global form resolve locally", () => {
    expect(codes([file({ id: M(1), fm: { links: [`demo:${M(2)}`] } })])).toEqual({
      ".aimem/memory/mem-00000001-x.md": ["V006"],
    });
  });

  it("V017 ignores surrounding whitespace and line-ending differences", () => {
    const f = file({ id: D(1), type: "decision", body: "line one\nline two", fm: src("line one\nline two") });
    f.text = f.text.replace(/\n/g, "\r\n").replace(/line two\r\n$/, "line two\r\n\r\n\r\n");
    expect(codes([f])).toEqual({});
  });

  it("a record with a broken header gets only that error", () => {
    expect(
      codes([file({ id: M(1), drop: ["summary"], fm: { roles: ["astronaut"] }, name: "x.md" })]),
    ).toEqual({
      ".aimem/memory/x.md": ["V002"],
    });
  });

  it("issues carry level, ref and a message", () => {
    const [issue] = validateFiles([file({ id: M(1), fm: { roles: ["astronaut"] } })], config, CLOCK.now());
    expect(issue).toMatchObject({
      code: "V014",
      level: "warn",
      ref: M(1),
      file: ".aimem/memory/mem-00000001-x.md",
    });
    expect(issue?.message).toContain("astronaut");
  });
});

describe("exitCodeFor (03 §9)", () => {
  const warn: Issue = { code: "V009", level: "warn", file: "f", message: "m" };
  const err: Issue = { code: "V002", level: "error", file: "f", message: "m" };
  it.each([
    [[], false, 0],
    [[warn], false, 0],
    [[warn], true, 1],
    [[warn, err], false, 2],
    [[err], true, 2],
  ] as [Issue[], boolean, number][])("%j strict=%s → %i", (issues, strict, code) => {
    expect(exitCodeFor(issues, strict)).toBe(code);
  });
});
