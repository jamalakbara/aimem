import {
  BODY_SECTIONS,
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  ERROR_CODES,
  RECORD_TYPES,
  STATUSES,
  TRUST_LEVELS,
  TRUST_WEIGHT,
  TYPE_DIR,
  TYPE_PREFIX,
} from "@aimem/schema";
import { describe, expect, it } from "vitest";

describe("constants match 03", () => {
  it("§1 directory layout and ID prefixes", () => {
    expect(RECORD_TYPES).toEqual([
      "decision",
      "task",
      "memory",
      "handoff",
      "incident",
      "runbook",
      "schema",
      "testcase",
    ]);
    expect(TYPE_DIR).toEqual({
      decision: "decisions",
      task: "tasks",
      memory: "memory",
      handoff: "handoffs",
      incident: "incidents",
      runbook: "runbooks",
      schema: "schema",
      testcase: "tests",
    });
    expect(TYPE_PREFIX).toEqual({
      decision: "dec",
      task: "tsk",
      memory: "mem",
      handoff: "hnd",
      incident: "inc",
      runbook: "run",
      schema: "sch",
      testcase: "tst",
    });
  });

  it("§4 status vocabulary", () => {
    expect(STATUSES).toEqual({
      decision: ["proposed", "accepted", "rejected", "superseded", "deprecated"],
      task: ["open", "in_progress", "blocked", "review", "done", "cancelled"],
      memory: ["active", "stale", "superseded"],
      handoff: ["final"],
      incident: ["investigating", "mitigated", "resolved", "postmortem_done"],
      runbook: ["active", "deprecated"],
      schema: ["active", "deprecated", "superseded"],
      testcase: ["draft", "ready", "passing", "failing", "retired"],
    });
  });

  it("§4 default status on create is allowed for its type; decision starts proposed", () => {
    for (const t of RECORD_TYPES) expect(STATUSES[t]).toContain(DEFAULT_STATUS[t]);
    expect(DEFAULT_STATUS.decision).toBe("proposed");
    expect(DEFAULT_PRIORITY).toBe("p2");
  });

  it("§5 trust levels and weights", () => {
    expect(TRUST_LEVELS).toEqual(["verified", "agent", "inferred"]);
    expect(TRUST_WEIGHT).toEqual({ verified: 1.0, agent: 0.7, inferred: 0.4 });
  });

  it("§3 handoff body sections", () => {
    expect(BODY_SECTIONS.handoff).toEqual(["Done", "Not done", "Next", "Blocked", "Notes for next agent"]);
    expect(BODY_SECTIONS.decision).toEqual(["Context", "Decision", "Consequences"]);
  });

  it("04 §7 error codes are exactly the stable list", () => {
    expect(ERROR_CODES).toEqual([
      "NOT_INITIALIZED",
      "INVALID_RECORD",
      "DUPLICATE_LIKELY",
      "CLAIM_CONFLICT",
      "NOT_FOUND",
      "SYNC_FAILED",
      "PERMISSION_DENIED",
      "SECRET_DETECTED",
      "SPEC_TOO_NEW",
      "READONLY_EXTERNAL",
      "SOURCE_AUTH",
      "SOURCE_UNREACHABLE",
    ]);
  });
});
