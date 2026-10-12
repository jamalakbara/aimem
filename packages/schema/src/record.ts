import { z } from "zod";
import { RECORD_TYPES, type RecordType, STATUSES, TRUST_LEVELS } from "./constants.js";
import { ID_RE, REF_RE } from "./refs.js";

const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "UTC ISO-8601 datetime");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const ref = z.string().regex(REF_RE, "record ref");
const author = z
  .string()
  .regex(/^(?:human|agent):[^\s:]+(?::\S+)?$/, "human:<handle> or agent:<tool>[:<model>]");

/** 03 §2.1 `external`: informational links to outside systems. */
export const externalLinkSchema = z.looseObject({
  system: z.string().min(1),
  id: z.string().min(1),
  url: z.string().optional(),
});

/** 03 §2.1 `source`: ownership of externally-managed records (16 §2). */
export const sourceSchema = z.looseObject({
  system: z.enum(["google-doc", "google-sheet", "odoo", "upload"]),
  id: z.string().min(1),
  url: z.string(),
  row: z.union([z.string(), z.number()]).optional(),
  version: z.union([z.string(), z.number()]),
  content_sha: z.string().min(1),
  synced_at: isoDateTime,
  imported_by: z.string().min(1),
  state: z.enum(["ok", "missing", "error"]),
});

/** 03 §2.1 common fields. No defaults are applied: parsing never adds keys. */
const commonShape = {
  aimem: z.number().int().positive(),
  id: z.string().regex(ID_RE, "<prefix>-<8 base32 chars>"),
  type: z.enum(RECORD_TYPES),
  title: z.string().min(1).max(120),
  summary: z.string().min(1),
  status: z.string().min(1),
  trust: z.enum(TRUST_LEVELS),
  roles: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()).optional(),
  repo: z.string().optional(),
  paths: z.array(z.string()).optional(),
  author,
  created: isoDateTime,
  updated: isoDateTime,
  verified: isoDate.optional(),
  links: z.array(ref).optional(),
  supersedes: ref.optional(),
  superseded_by: ref.optional(),
  expires: isoDate.optional(),
  external: z.array(externalLinkSchema).optional(),
  managed_by: z.enum(["notebook", "external"]).optional(),
  source: sourceSchema.optional(),
  evidence: z.array(z.string()).optional(),
};

/** 03 §3: type-specific fields (all optional). */
const extras = {
  decision: { decided_by: z.array(z.string()).optional() },
  task: {
    assignee: z.string().optional(),
    priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
    blocked_by: z.array(ref).optional(),
    due: isoDate.optional(),
  },
  memory: { kind: z.enum(["gotcha", "constraint", "howto", "fact", "preference"]).optional() },
  handoff: { session: z.string().optional(), task: ref.optional(), branch: z.string().optional() },
  incident: {
    severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).optional(),
    started: z.string().optional(),
    resolved_at: z.string().optional(),
    services: z.array(z.string()).optional(),
    root_cause_category: z.string().optional(),
  },
  runbook: { last_tested: isoDate.optional(), owner: z.string().optional() },
  schema: { datastore: z.string().optional(), objects: z.array(z.string()).optional() },
  testcase: { covers: z.array(ref).optional(), automation: z.string().optional() },
} satisfies Record<RecordType, z.ZodRawShape>;

function requireSourceWhenExternal(
  fm: { managed_by?: string; source?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (fm.managed_by === "external" && fm.source === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["source"],
      message: "source is required when managed_by is external",
    });
  }
}

/**
 * Common fields only; `status` is any string. Lets the validator report a bad
 * status as V004 rather than V002 (03 §9).
 */
export const baseFrontmatterSchema = z.looseObject(commonShape).superRefine(requireSourceWhenExternal);

function typed<T extends RecordType>(type: T) {
  return z.looseObject({
    ...commonShape,
    ...extras[type],
    type: z.literal(type),
    status: z.enum(STATUSES[type]),
  });
}

/** Full record frontmatter: common fields + per-type statuses and fields. */
export const recordSchema = z
  .discriminatedUnion("type", [
    typed("decision"),
    typed("task"),
    typed("memory"),
    typed("handoff"),
    typed("incident"),
    typed("runbook"),
    typed("schema"),
    typed("testcase"),
  ])
  .superRefine(requireSourceWhenExternal);

export type BaseFrontmatter = z.infer<typeof baseFrontmatterSchema>;
export type Frontmatter = z.infer<typeof recordSchema>;
export type Source = z.infer<typeof sourceSchema>;
