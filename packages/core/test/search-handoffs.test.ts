import { readFileSync } from "node:fs";
import { bm25, buildIndex, FIELD_BOOSTS, search } from "@aimem/core";
import type { RecordType } from "@aimem/schema";
import { expect, it } from "vitest";
import YAML from "yaml";

const fixture = YAML.parse(
  readFileSync(new URL("../../../fixtures/evals/search-dogfood.yaml", import.meta.url), "utf8"),
) as {
  records: { id: string; type: RecordType; title: string; summary: string; body: string }[];
  cases: { id: string; query: string; expected: string; semantic?: Record<string, number> }[];
};
const index = buildIndex(
  fixture.records.map((r) => ({
    file: `.aimem/${r.type === "handoff" ? "handoffs" : "memory"}/${r.id}-example.md`,
    dirType: r.type,
    text: `---\naimem: 1\nid: ${r.id}\ntype: ${r.type}\ntitle: ${r.title}\nsummary: ${r.summary}\nstatus: ${r.type === "handoff" ? "final" : "active"}\ntrust: agent\nroles: [dev]\nauthor: agent:fixture\ncreated: 2026-11-01T00:00:00Z\nupdated: 2026-11-01T00:00:00Z\n---\n${r.body}`,
  })),
);

it.each(fixture.cases)("ranks the direct answer first: $id", (c) => {
  const hits = search(
    index,
    c.query,
    { limit: 10 },
    c.semantic ? { scores: new Map(Object.entries(c.semantic)) } : undefined,
  );
  expect(hits[0]?.record.id).toBe(c.expected);
  expect(hits[0]?.score).toBe(1);
});

it("keeps explicit handoff searches useful and scores normalized", () => {
  const hits = search(index, "tests", { types: ["handoff"], limit: 10 });
  expect(hits.length).toBe(2);
  expect(hits.every((h) => h.record.type === "handoff")).toBe(true);
  expect(hits[0]?.score).toBe(1);
  expect(search(index, "tests").some((h) => h.record.type === "handoff")).toBe(true);
});

it.each(["handoff tests", "last session tests", "what happened during tests", "riwayat tests"])(
  "preserves the original history relevance for %s",
  (query) => {
    const original = bm25(
      index.records.map((r) => ({
        id: r.id,
        fields: { title: r.title, summary: r.summary, tags: r.tags.join(" "), body: r.body },
      })),
      query,
      FIELD_BOOSTS,
    );
    for (const hit of search(index, query, { limit: 10 }))
      expect(hit.raw).toBeCloseTo(original.get(hit.record.id) ?? 0, 10);
  },
);
