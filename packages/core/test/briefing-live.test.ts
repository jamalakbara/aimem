import { join } from "node:path";
import {
  ageLabel,
  buildBriefing,
  type LiveClaimEntry,
  type LiveState,
  loadIndex,
  loadProject,
  type Notebook,
  type NotebookIndex,
  nodeFs,
} from "@aimem/core";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const NOW = new Date("2026-10-12T00:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
let nb: Notebook;
let index: NotebookIndex;

beforeAll(async () => {
  nb = await loadProject(nodeFs, join(FIXTURES, "tiny"));
  index = await loadIndex(nb, { fs: nodeFs });
});

function claim(fields: Partial<LiveClaimEntry> & { task?: string; id?: string }): LiveClaimEntry {
  const started = fields.started ?? ago(18);
  return {
    holder: "human:rina",
    session: "s",
    started,
    heartbeat: started,
    ttl_minutes: 180,
    expired: false,
    expiresAt: new Date(Date.parse(started) + 180 * 60_000).toISOString(),
    ...fields,
  } as LiveClaimEntry;
}

const brief = (live: LiveState, extra: Record<string, unknown> = {}) =>
  buildBriefing(nb, index, { live, liveHolder: "agent:me", ...extra }, NOW);

describe("briefing live section (06 §2.3)", () => {
  it("warns when the requested task is claimed by someone else and lists live claims", () => {
    const b = brief(
      {
        status: "on",
        claims: [
          claim({ task: "acme-ledger:tsk-3c4d5e6f", paths: ["db/migrations/**"] }),
          claim({ id: "clm-01234567", paths: ["docs/**"], holder: "agent:me", started: ago(5) }),
          claim({ task: "acme-ledger:tsk-4d5e6f7g", expired: true, started: ago(400) }),
        ],
      },
      { ref: "tsk-3c4d5e6f" },
    );
    expect(b.header.live).toBe("on");
    expect(b.markdown).toContain("live claims: 2 active");
    expect(b.warnings[0]).toBe(
      "tsk-3c4d5e6f is claimed by human:rina (18m ago). Check with them before working on it.",
    );
    const section = b.markdown.slice(
      b.markdown.indexOf("## Live"),
      b.markdown.indexOf("\n\n", b.markdown.indexOf("## Live")),
    );
    expect(section.split("\n")).toEqual([
      "## Live",
      "- acme-ledger:tsk-3c4d5e6f Add currency column to ledger entries — human:rina — db/migrations/** — 18m — overlaps your paths",
      "- clm-01234567 — agent:me (you) — docs/** — 5m",
      "- acme-ledger:tsk-4d5e6f7g Write rounding tests for fee splits — human:rina — — — 6h40m — possibly abandoned",
    ]);
    expect(b.live.claims[0]).toMatchObject({
      overlaps: true,
      title: "Add currency column to ledger entries",
    });
    expect(b.live.claims[1]).toMatchObject({ mine: true });
  });

  it("warns about overlapping paths but not about own, expired or unsynced claims", () => {
    const b = brief(
      {
        status: "on",
        claims: [
          claim({ id: "clm-11111111", paths: ["src/ledger/**"] }),
          claim({ id: "clm-22222222", paths: ["src/ledger/**"], holder: "agent:me" }),
          claim({ id: "clm-33333333", paths: ["src/ledger/**"], expired: true }),
          claim({ id: "clm-44444444", paths: ["src/ledger/**"], unsynced: true }),
          claim({ id: "clm-55555555", paths: ["docs/**"] }),
        ],
      },
      { paths: ["src/ledger/entries.ts"] },
    );
    expect(b.warnings.filter((w) => w.includes("overlaps your paths"))).toEqual([
      "human:rina claimed clm-11111111 18m ago on src/ledger/**, which overlaps your paths.",
    ]);
    expect(b.markdown).toContain("— unsynced, overlaps your paths");
  });

  it("separates an unavailable remote from an empty result", () => {
    const down = brief({ status: "unavailable", reason: "Could not fetch aimem-live.", claims: [] });
    expect(down.markdown).toContain("live claims: unavailable");
    expect(down.warnings[0]).toBe(
      "Team claims could not be checked (Could not fetch aimem-live.). Run aimem live once the connection is back.",
    );
    const empty = brief({ status: "on", claims: [] });
    expect(empty.markdown).toContain("## Live\n- No active claims.");
    expect(empty.warnings).toEqual([]);
    const skipped = brief({ status: "skipped", reason: "--no-live", claims: [] });
    expect(skipped.markdown).toContain("live claims: skipped (--no-live)");
    expect(skipped.markdown).not.toContain("## Live");
    expect(skipped.live).toEqual({ status: "skipped", reason: "--no-live", claims: [] });
  });

  it("shows shared participants and keeps the live section within its cap", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      claim({ id: `clm-${String(i).padStart(8, "0")}`, paths: [`area-${i}/**`] }),
    );
    const shared = claim({
      task: "acme-ledger:tsk-3c4d5e6f",
      shared: true,
      participants: [
        { holder: "human:rina", session: "a", joined: ago(18), heartbeat: ago(18) },
        { holder: "agent:me", session: "b", joined: ago(3), heartbeat: ago(3) },
      ],
    });
    const b = brief({ status: "on", claims: [shared, ...many] }, { budget: 1000 });
    expect(b.markdown).toContain("human:rina, agent:me (you)");
    expect(b.markdown).toContain("— shared");
    expect(b.markdown).toMatch(/- … \d+ more in aimem live/);
    expect(b.live.claims).toHaveLength(31);
  });

  it("formats ages compactly", () => {
    expect([ageLabel(0), ageLabel(59 * 60_000), ageLabel(125 * 60_000), ageLabel(72 * 3_600_000)]).toEqual([
      "0m",
      "59m",
      "2h05m",
      "3d",
    ]);
  });
});
