/** Spec major version this package implements (03 §10). */
export const SPEC_VERSION = 1;

/** 03 §1. Core types first, then extended. */
export const RECORD_TYPES = [
  "decision",
  "task",
  "memory",
  "handoff",
  "incident",
  "runbook",
  "schema",
  "testcase",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const TYPE_DIR: Record<RecordType, string> = {
  decision: "decisions",
  task: "tasks",
  memory: "memory",
  handoff: "handoffs",
  incident: "incidents",
  runbook: "runbooks",
  schema: "schema",
  testcase: "tests",
};

export const TYPE_PREFIX: Record<RecordType, string> = {
  decision: "dec",
  task: "tsk",
  memory: "mem",
  handoff: "hnd",
  incident: "inc",
  runbook: "run",
  schema: "sch",
  testcase: "tst",
};

/** 03 §4. */
export const STATUSES = {
  decision: ["proposed", "accepted", "rejected", "superseded", "deprecated"],
  task: ["open", "in_progress", "blocked", "review", "done", "cancelled"],
  memory: ["active", "stale", "superseded"],
  handoff: ["final"],
  incident: ["investigating", "mitigated", "resolved", "postmortem_done"],
  runbook: ["active", "deprecated"],
  schema: ["active", "deprecated", "superseded"],
  testcase: ["draft", "ready", "passing", "failing", "retired"],
} as const satisfies Record<RecordType, readonly [string, ...string[]]>;
export type Status<T extends RecordType = RecordType> = (typeof STATUSES)[T][number];

/** 03 §4: status given to a new record when none is specified. */
export const DEFAULT_STATUS: { [T in RecordType]: Status<T> } = {
  decision: "proposed",
  task: "open",
  memory: "active",
  handoff: "final",
  incident: "investigating",
  runbook: "active",
  schema: "active",
  testcase: "draft",
};

/** 03 §3.2: task priority when the field is absent. */
export const DEFAULT_PRIORITY = "p2";

/** 03 §5. */
export const TRUST_LEVELS = ["verified", "agent", "inferred"] as const;
export type Trust = (typeof TRUST_LEVELS)[number];
export const TRUST_WEIGHT: Record<Trust, number> = { verified: 1.0, agent: 0.7, inferred: 0.4 };

/** 03 §3: required body sections per type (memory body is free). */
export const BODY_SECTIONS: Record<RecordType, readonly string[]> = {
  decision: ["Context", "Decision", "Consequences"],
  task: ["Goal", "Acceptance criteria", "Notes"],
  memory: [],
  handoff: ["Done", "Not done", "Next", "Blocked", "Notes for next agent"],
  incident: ["Impact", "Timeline", "Root cause", "Fix", "Prevention"],
  runbook: ["When to use", "Steps", "Rollback", "Verify"],
  schema: ["Shape", "Invariants", "Migration notes", "Gotchas"],
  testcase: ["Preconditions", "Steps", "Expected", "Last result"],
};

/** 03 §2.1: tags with special meaning. */
export const RESERVED_TAGS = ["pinned", "imported", "adopted", "no-embed"] as const;

/** 04 §7: stable error codes. */
export const ERROR_CODES = [
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
  "USAGE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
