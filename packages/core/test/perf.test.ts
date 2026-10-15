import { buildIndex, renderIndexMd, search } from "@aimem/core";
import { ID_ALPHABET } from "@aimem/schema";
import { describe, expect, it } from "vitest";

const WORDS =
  "ledger webhook retry idempotent schema migration claim branch embedding briefing handoff decision agent token budget".split(
    " ",
  );

describe("performance budget (12 §5)", () => {
  it("indexes and searches 5,000 records in under 3 seconds", () => {
    const texts = Array.from({ length: 5000 }, (_, i) => {
      const id = `mem-${[...i.toString(32).padStart(8, "0")].map((c) => ID_ALPHABET[Number.parseInt(c, 32)]).join("")}`;
      const w = (k: number) => WORDS[(i * 7 + k * 3) % WORDS.length];
      return {
        file: `.aimem/memory/${id}-x.md`,
        dirType: "memory" as const,
        text: `---\naimem: 1\nid: ${id}\ntype: memory\ntitle: ${w(1)} ${w(2)} note ${i}\nsummary: About ${w(3)} and ${w(4)} in record ${i}.\nstatus: active\ntrust: agent\nroles: [dev]\ntags: [${w(5)}]\nauthor: agent:test\ncreated: 2026-10-01T09:00:00Z\nupdated: 2026-10-01T09:00:00Z\n---\n\n${Array.from({ length: 60 }, (_, k) => w(k)).join(" ")}\n`,
      };
    });
    // Best of 3: the suite runs files in parallel, so a single timing measures machine load, not aimem.
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      const index = buildIndex(texts);
      const hits = search(index, "webhook retry idempotent", { limit: 10 });
      renderIndexMd(
        { aimem: 1, project: "perf", mode: "solo", sync: "none", roles: ["dev"], freshness_days: {} },
        index,
      );
      best = Math.min(best, performance.now() - t0);
      expect(index.records).toHaveLength(5000);
      expect(hits).toHaveLength(10);
    }
    expect(best).toBeLessThan(3000);
  });
});
