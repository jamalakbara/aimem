import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AimemError,
  addRecord,
  bodyTemplate,
  loadProject,
  type Notebook,
  nodeFs,
  resolveAuthor,
  supersedeRecord,
  updateRecord,
  validateNotebook,
  verifyRecords,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

let root: string;
let nb: Notebook;
let n = 0;
const clock = { now: () => new Date("2026-10-12T08:30:00Z") };
const nextByte = () => {
  n += 7;
  return n % 256;
};
const deps = () => ({
  fs: nodeFs,
  clock,
  random: { bytes: (k: number) => Uint8Array.from({ length: k }, nextByte) },
});

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-ops-"));
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
  nb = await loadProject(nodeFs, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const files = (dir: string) => readdirSync(join(root, ".aimem", dir)).sort();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AimemError) return e.code;
    throw e;
  }
}

const memory = {
  type: "memory" as const,
  title: "Bank exports use semicolons",
  summary: "CSV exports from the bank use ';' as separator and a comma as decimal mark.",
  body: "Seen in the September export. Parse with an explicit delimiter.",
  author: "agent:claude-code",
};

describe("resolveAuthor (04 §1)", () => {
  it("prefers the flag, then AIMEM_AUTHOR", () => {
    expect(resolveAuthor({ flag: "human:akbar", env: { AIMEM_AUTHOR: "agent:x" } })).toBe("human:akbar");
    expect(resolveAuthor({ env: { AIMEM_AUTHOR: "agent:claude-code:opus" } })).toBe("agent:claude-code:opus");
  });
  it.each([[{ env: {} }], [{ flag: "akbar", env: {} }]])(
    "rejects missing or malformed authors %j",
    (input) => {
      expect(() => resolveAuthor(input)).toThrow(AimemError);
    },
  );
});

describe("addRecord", () => {
  it("writes a valid record, refreshes INDEX.md and keeps the notebook clean", async () => {
    const r = await addRecord(nb, { ...memory, fields: { kind: "gotcha" }, tags: ["bank"] }, deps());
    expect(r.ref).toMatch(/^mem-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(r.file).toBe(`.aimem/memory/${r.ref}-bank-exports-use-semicolons.md`);
    expect(r.changed).toEqual([r.file, ".aimem/INDEX.md"]);
    const text = read(r.file);
    expect(text).toContain("trust: agent\n");
    expect(text).toContain("created: 2026-10-12T08:30:00Z\n");
    expect(text).toContain("kind: gotcha\n");
    expect(text).not.toContain("verified:");
    expect(read(".aimem/INDEX.md")).toContain("memory: 3");
    expect(await validateNotebook(nb, { fs: nodeFs, clock })).toEqual([]);
  });

  it("humans get trust verified and today's verified date; decisions default to proposed", async () => {
    const r = await addRecord(
      nb,
      {
        type: "decision",
        title: "Reconcile nightly",
        summary: "Run reconciliation every night at 02:00 UTC.",
        body: "## Context\nx\n\n## Decision\ny\n\n## Consequences\nz",
        author: "human:akbar",
      },
      deps(),
    );
    const text = read(r.file);
    expect(text).toContain("status: proposed\n");
    expect(text).toContain("trust: verified\n");
    expect(text).toContain("verified: 2026-10-12\n");
  });

  it("supersedes the old record in the same step", async () => {
    const r = await addRecord(
      nb,
      {
        type: "decision",
        title: "Store money as decimal strings",
        summary: "Replaces integer minor units with decimal strings at the edge.",
        body: "b",
        author: "human:akbar",
        status: "accepted",
        supersedes: "dec-1a2b3c4d",
      },
      deps(),
    );
    expect(r.changed).toContain(".aimem/decisions/dec-1a2b3c4d-store-money-as-integer-minor-units.md");
    const old = read(".aimem/decisions/dec-1a2b3c4d-store-money-as-integer-minor-units.md");
    expect(old).toContain("status: superseded\n");
    expect(old).toContain(`superseded_by: ${r.ref}\n`);
    expect(old).toContain("updated: 2026-10-12T08:30:00Z\n");
    expect(await validateNotebook(nb, { fs: nodeFs, clock })).toEqual([]);
  });

  it("without a body writes nothing and returns the template", async () => {
    const before = files("memory");
    try {
      await addRecord(nb, { ...memory, body: "  " }, deps());
      expect.unreachable();
    } catch (e) {
      expect((e as AimemError).code).toBe("INVALID_RECORD");
      expect((e as AimemError).details?.template).toBe(bodyTemplate("memory"));
    }
    expect(files("memory")).toEqual(before);
    expect(bodyTemplate("handoff")).toContain("## Not done\nTODO");
  });

  it("flags a likely duplicate (exit-3 code) unless forced", async () => {
    const dup = {
      ...memory,
      title: "Payment provider sends amounts as strings",
      summary: "The payment provider sends amounts as strings in webhooks; never cast to float.",
    };
    expect(await codeOf(addRecord(nb, dup, deps()))).toBe("DUPLICATE_LIKELY");
    try {
      await addRecord(nb, dup, deps());
    } catch (e) {
      expect((e as AimemError).details).toMatchObject({ ref: "mem-5e6f7g8h" });
    }
    expect(await codeOf(addRecord(nb, { ...dup, force: true }, deps()))).toBe("ok");
    expect(
      await codeOf(
        addRecord(
          nb,
          {
            ...memory,
            title: "Payment provider retries webhooks",
            summary: "Webhooks are retried for 24 hours with backoff.",
          },
          deps(),
        ),
      ),
    ).toBe("ok");
  });

  it.each([
    ["secret in body", { body: ["api_key = ", "Zq8xW3vN0pLk7Rt2Yb5M"].join("") }, "SECRET_DETECTED"],
    ["status not allowed", { status: "accepted" }, "INVALID_RECORD"],
    ["unknown link", { links: ["tsk-zzzzzzzz"] }, "INVALID_RECORD"],
    ["supersede unknown", { supersedes: "mem-zzzzzzzz" }, "NOT_FOUND"],
    ["supersede other type", { supersedes: "dec-1a2b3c4d" }, "INVALID_RECORD"],
    ["multi-line summary", { summary: "line one\nline two" }, "INVALID_RECORD"],
    ["summary too long", { summary: "x".repeat(201) }, "INVALID_RECORD"],
    ["bad kind", { fields: { kind: "rumour" } }, "INVALID_RECORD"],
    ["bad author", { author: "akbar" }, "USAGE"],
  ])("refuses %s and writes nothing", async (_n, patch, code) => {
    const before = [files("memory"), files("decisions")];
    expect(await codeOf(addRecord(nb, { ...memory, ...patch }, deps()))).toBe(code);
    expect([files("memory"), files("decisions")]).toEqual(before);
  });

  it("warns about unknown roles and leftover TODO markers but still writes", async () => {
    const r = await addRecord(nb, { ...memory, roles: ["astronaut"], body: bodyTemplate("memory") }, deps());
    expect(r.warnings.join(" ")).toMatch(/astronaut/);
    expect(r.warnings.join(" ")).toMatch(/TODO/);
  });
});

describe("updateRecord", () => {
  const task = ".aimem/tasks/tsk-3c4d5e6f-add-currency-column-to-ledger-entries.md";

  it("changes only the given fields and the updated timestamp", async () => {
    const before = read(task);
    await updateRecord(
      nb,
      "tsk-3c4d5e6f",
      { set: { status: "review", tags: "money,migration,review" }, author: "agent:claude-code" },
      deps(),
    );
    const diff = before.split("\n").flatMap((l, i) => (l === read(task).split("\n")[i] ? [] : [l]));
    expect(diff).toEqual([
      "status: in_progress",
      "tags: [money, migration]",
      "updated: 2026-10-08T16:20:00Z",
    ]);
    expect(read(task)).toContain("tags: [money, migration, review]\n");
  });

  it("an empty value removes the field; the body can be replaced", async () => {
    await updateRecord(
      nb,
      "tsk-3c4d5e6f",
      { set: { assignee: "" }, body: "## Goal\nNew goal.", author: "agent:x" },
      deps(),
    );
    expect(read(task)).not.toContain("assignee:");
    expect(read(task)).toMatch(/---\n\n## Goal\nNew goal.\n$/);
  });

  it.each([
    ["unknown ref", "tsk-zzzzzzzz", { set: { status: "done" } }, "NOT_FOUND"],
    ["protected field", "tsk-3c4d5e6f", { set: { trust: "verified" } }, "INVALID_RECORD"],
    ["bad status", "tsk-3c4d5e6f", { set: { status: "accepted" } }, "INVALID_RECORD"],
    ["handoff body", "hnd-7g8h9j0k", { body: "rewrite" }, "PERMISSION_DENIED"],
    ["secret", "tsk-3c4d5e6f", { body: ["password: ", "Zq8xW3vN0pLk7Rt2"].join("") }, "SECRET_DETECTED"],
    ["nothing to change", "tsk-3c4d5e6f", {}, "USAGE"],
  ])("refuses %s", async (_n, ref, input, code) => {
    const before = read(task);
    expect(await codeOf(updateRecord(nb, ref, { ...input, author: "agent:x" }, deps()))).toBe(code);
    expect(read(task)).toBe(before);
  });

  it("allows a handoff body change with force", async () => {
    expect(
      await codeOf(
        updateRecord(
          nb,
          "hnd-7g8h9j0k",
          {
            body: "## Done\nx\n\n## Not done\nx\n\n## Next\nx\n\n## Blocked\nnone\n\n## Notes for next agent\nnone",
            force: true,
            author: "human:akbar",
          },
          deps(),
        ),
      ),
    ).toBe("ok");
  });

  it("refuses externally-owned records", async () => {
    const messyRoot = mkdtempSync(join(tmpdir(), "aimem-ops-messy-"));
    try {
      cpSync(join(FIXTURES, "messy"), messyRoot, { recursive: true });
      const m = await loadProject(nodeFs, messyRoot);
      expect(
        await codeOf(
          updateRecord(m, "dec-0000001e", { set: { status: "deprecated" }, author: "human:akbar" }, deps()),
        ),
      ).toBe("READONLY_EXTERNAL");
    } finally {
      rmSync(messyRoot, { recursive: true, force: true });
    }
  });
});

describe("supersedeRecord and verifyRecords", () => {
  it("links both records and marks the old one superseded", async () => {
    const r = await addRecord(
      nb,
      {
        ...memory,
        title: "Amounts arrive as decimal strings",
        summary: "Provider payloads carry decimal strings; parse with the money helper.",
      },
      deps(),
    );
    await supersedeRecord(nb, "mem-5e6f7g8h", r.ref, deps());
    expect(read(".aimem/memory/mem-5e6f7g8h-payment-provider-sends-amounts-as-strings.md")).toContain(
      `superseded_by: ${r.ref}\n`,
    );
    expect(read(r.file)).toContain("supersedes: mem-5e6f7g8h\n");
    expect(await validateNotebook(nb, { fs: nodeFs, clock })).toEqual([]);
  });

  it.each([
    ["self", "mem-5e6f7g8h", "mem-5e6f7g8h", "INVALID_RECORD"],
    ["different types", "mem-5e6f7g8h", "dec-1a2b3c4d", "INVALID_RECORD"],
    ["type without superseded", "tsk-3c4d5e6f", "tsk-4d5e6f7g", "INVALID_RECORD"],
    ["unknown", "mem-zzzzzzzz", "mem-5e6f7g8h", "NOT_FOUND"],
  ])("refuses %s", async (_n, a, b, code) => {
    expect(await codeOf(supersedeRecord(nb, a, b, deps()))).toBe(code);
  });

  it("verify: humans only; sets trust and date", async () => {
    expect(await codeOf(verifyRecords(nb, ["mem-6f7g8h9j"], "agent:claude-code", deps()))).toBe(
      "PERMISSION_DENIED",
    );
    const r = await verifyRecords(nb, ["mem-6f7g8h9j", "tsk-4d5e6f7g"], "human:akbar", deps());
    expect(r.refs).toEqual(["mem-6f7g8h9j", "tsk-4d5e6f7g"]);
    const text = read(".aimem/memory/mem-6f7g8h9j-monthly-reports-must-reconcile-to-the-cent.md");
    expect(text).toContain("trust: verified\n");
    expect(text).toContain("verified: 2026-10-12\n");
  });
});
