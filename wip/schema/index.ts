import { z } from "zod";

export const SPEC_VERSION = 1;

export const RECORD_TYPES = ["decision", "task", "memory", "handoff", "incident", "runbook", "schema", "testcase"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const TYPE_DIR: Record<RecordType, string> = {
  decision: "decisions", task: "tasks", memory: "memory", handoff: "handoffs",
  incident: "incidents", runbook: "runbooks", schema: "schema", testcase: "tests",
};
export const TYPE_PREFIX: Record<RecordType, string> = {
  decision: "dec", task: "tsk", memory: "mem", handoff: "hnd",
  incident: "inc", runbook: "run", schema: "sch", testcase: "tst",
};
export const STATUSES: Record<RecordType, readonly string[]> = {
  decision: ["proposed", "accepted", "rejected", "superseded", "deprecated"],
  task: ["open", "in_progress", "blocked", "review", "done", "cancelled"],
  memory: ["active", "stale", "superseded"],
  handoff: ["final"],
  incident: ["investigating", "mitigated", "resolved", "postmortem_done"],
  runbook: ["active", "deprecated"],
  schema: ["active", "deprecated", "superseded"],
  testcase: ["draft", "ready", "passing", "failing", "retired"],
};
export const DEFAULT_STATUS: Record<RecordType, string> = {
  decision: "accepted", task: "open", memory: "active", handoff: "final",
  incident: "investigating", runbook: "active", schema: "active", testcase: "draft",
};
/** Statuses that mean "no longer current" (excluded from briefings by default). */
export const INACTIVE_STATUSES = new Set(["superseded", "rejected", "cancelled", "done", "retired", "deprecated"]);

export const TRUST_LEVELS = ["verified", "agent", "inferred"] as const;
export type Trust = (typeof TRUST_LEVELS)[number];
export const TRUST_WEIGHT: Record<Trust, number> = { verified: 1.0, agent: 0.7, inferred: 0.4 };

export const DEFAULT_ROLES = ["dev", "pm", "qa", "db", "devops", "analyst", "all"] as const;

/** Required sections per type (body template). */
export const BODY_SECTIONS: Record<RecordType, string[]> = {
  decision: ["Context", "Decision", "Consequences"],
  task: ["Goal", "Acceptance criteria", "Notes"],
  memory: [],
  handoff: ["Done", "Not done", "Next", "Blocked", "Notes for next agent"],
  incident: ["Impact", "Timeline", "Root cause", "Fix", "Prevention"],
  runbook: ["When to use", "Steps", "Rollback", "Verify"],
  schema: ["Shape", "Invariants", "Migration notes", "Gotchas"],
  testcase: ["Preconditions", "Steps", "Expected", "Last result"],
};

export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_RE = /^([a-z]{3})-([0-9a-hjkmnp-tv-z]{8})$/;

export function newId(type: RecordType, rand: (n: number) => Uint8Array = defaultRand): string {
  const bytes = rand(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[(bytes[i] ?? 0) % 32];
  return `${TYPE_PREFIX[type]}-${s}`;
}
function defaultRand(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
export function isValidId(id: string): boolean { return ID_RE.test(id); }
export function typeFromId(id: string): RecordType | undefined {
  const m = ID_RE.exec(id);
  return m ? RECORD_TYPES.find((t) => TYPE_PREFIX[t] === m[1]) : undefined;
}

export interface Ref { project?: string; id: string }
export function parseRef(ref: string): Ref {
  const i = ref.indexOf(":");
  return i < 0 ? { id: ref } : { project: ref.slice(0, i), id: ref.slice(i + 1) };
}

export function slugify(s: string, max = 60): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "") || "untitled";
}

const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "UTC ISO-8601 datetime");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** Frontmatter. Unknown keys are preserved (passthrough) for forward compatibility. */
export const frontmatterSchema = z.object({
  aimem: z.number().int(),
  id: z.string().regex(ID_RE, "<prefix>-<8 base32 chars>"),
  type: z.enum(RECORD_TYPES),
  title: z.string().min(1).max(120),
  summary: z.string().min(1),
  status: z.string().min(1),
  trust: z.enum(TRUST_LEVELS),
  roles: z.array(z.string()).min(1),
  tags: z.array(z.string()).optional(),
  repo: z.string().optional(),
  paths: z.array(z.string()).optional(),
  author: z.string().min(1),
  created: isoDateTime,
  updated: isoDateTime,
  verified: isoDate.optional(),
  links: z.array(z.string()).optional(),
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
  expires: isoDate.optional(),
  managed_by: z.enum(["notebook", "external"]).optional(),
  evidence: z.array(z.string()).optional(),
}).passthrough();
export type Frontmatter = z.infer<typeof frontmatterSchema>;

export const projectSchema = z.object({
  aimem: z.number().int(),
  project: z.string().min(1),
  name: z.string().optional(),
  mode: z.enum(["solo", "team", "team-realtime"]).default("solo"),
  sync: z.enum(["none", "git", "server"]).default("none"),
  repo: z.string().optional(),
  roles: z.array(z.string()).default([...DEFAULT_ROLES]),
  members: z.array(z.object({ handle: z.string(), roles: z.array(z.string()).default([]) })).optional(),
  write_policy: z.object({
    agent_commits: z.enum(["none", "stage", "commit", "pr"]).default("commit"),
    durable_requires_review: z.boolean().default(false),
    live_push: z.enum(["auto", "manual"]).default("auto"),
  }).default({}),
  freshness_days: z.record(z.number()).default({ memory: 90, runbook: 180, schema: 120 }),
  briefing: z.object({ budget_tokens: z.number().default(4000), max_handoffs: z.number().default(2) }).default({}),
}).passthrough();
export type ProjectConfig = z.infer<typeof projectSchema>;

export const ERROR_CODES = [
  "NOT_INITIALIZED", "INVALID_RECORD", "DUPLICATE_LIKELY", "CLAIM_CONFLICT", "NOT_FOUND", "SYNC_FAILED",
  "PERMISSION_DENIED", "SECRET_DETECTED", "SPEC_TOO_NEW", "READONLY_EXTERNAL", "SOURCE_AUTH", "SOURCE_UNREACHABLE", "USAGE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
