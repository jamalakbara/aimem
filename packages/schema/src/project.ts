import { z } from "zod";
import { PROJECT_SLUG_RE } from "./refs.js";

const posInt = z.number().int().positive();
const nullableString = z.string().nullable();

/** 15 §11. */
const retrievalSchema = z.looseObject({
  mode: z.enum(["lexical", "hybrid"]).optional(),
  fusion: z.enum(["weighted", "rrf"]).optional(),
  embeddings: z
    .looseObject({
      provider: z.enum(["local", "openai-compatible", "none"]).optional(),
      model: nullableString.optional(),
      endpoint: nullableString.optional(),
      allow_remote: z.boolean().optional(),
    })
    .optional(),
  rerank: z.enum(["none", "cross-encoder", "llm"]).optional(),
  query_rewrite: z.enum(["none", "llm"]).optional(),
  llm: z
    .looseObject({
      provider: z.enum(["none", "openai-compatible"]).optional(),
      endpoint: nullableString.optional(),
      model: nullableString.optional(),
    })
    .optional(),
});

/**
 * 03 §6 `project.yaml`. Only `aimem` and `project` are required. No defaults are
 * applied here (see PROJECT_DEFAULTS); unknown keys are preserved.
 */
export const projectSchema = z.looseObject({
  aimem: z.number().int().positive(),
  project: z.string().regex(PROJECT_SLUG_RE, "lowercase kebab slug"),
  name: z.string().optional(),
  mode: z.enum(["solo", "team", "team-realtime"]).optional(),
  sync: z.enum(["none", "git", "server"]).optional(),
  repo: z.string().optional(),
  repos: z.array(z.looseObject({ name: z.string().min(1), url: z.string().optional() })).optional(),
  hub: z.looseObject({ url: z.string().min(1), path: z.string().optional() }).optional(),
  roles: z.array(z.string().min(1)).min(1).optional(),
  members: z
    .array(z.looseObject({ handle: z.string().min(1), roles: z.array(z.string()).optional() }))
    .optional(),
  write_policy: z
    .looseObject({
      agent_commits: z.enum(["none", "stage", "commit", "pr"]).optional(),
      durable_requires_review: z.boolean().optional(),
      live_push: z.enum(["auto", "manual"]).optional(),
    })
    .optional(),
  freshness_days: z.record(z.string(), posInt).optional(),
  briefing: z
    .looseObject({
      budget_tokens: posInt.optional(),
      max_handoffs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  retrieval: retrievalSchema.optional(),
  connectors: z
    .looseObject({ google: z.looseObject({ inbox_folder_id: nullableString.optional() }).optional() })
    .optional(),
  claims: z.looseObject({ ttl_minutes: posInt.optional(), heartbeat_minutes: posInt.optional() }).optional(),
  server: z.looseObject({ url: z.string().optional(), project_id: z.string().optional() }).optional(),
});

export type ProjectConfig = z.infer<typeof projectSchema>;

/** Values from the 03 §6 example, applied by tools when a key is absent. Mode-dependent policy lives in core. */
export const PROJECT_DEFAULTS = {
  mode: "solo",
  sync: "none",
  roles: ["dev", "pm", "qa", "db", "devops", "analyst"],
  freshness_days: { memory: 90, runbook: 180, schema: 120 },
  briefing: { budget_tokens: 4000, max_handoffs: 2 },
  claims: { ttl_minutes: 180, heartbeat_minutes: 20 },
  hub_path: ".aimem",
} as const;
