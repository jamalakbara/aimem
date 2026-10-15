import { projectSchema } from "@aimem/schema";
import { describe, expect, it } from "vitest";

/** The project.yaml example from 03 §6 (with 15 §11 retrieval keys). */
const full = {
  aimem: 1,
  project: "acme-platform",
  name: "Acme Platform",
  mode: "team",
  sync: "git",
  repo: "backend",
  repos: [
    { name: "frontend", url: "git@github.com:acme/frontend.git" },
    { name: "backend", url: "git@github.com:acme/backend.git" },
  ],
  hub: { url: "git@github.com:acme/project-hub.git", path: ".aimem" },
  roles: ["dev", "pm", "qa", "db", "devops", "analyst"],
  members: [{ handle: "akbar", roles: ["dev", "devops"] }],
  write_policy: { agent_commits: "stage", durable_requires_review: true, live_push: "auto" },
  freshness_days: { memory: 90, runbook: 180, schema: 120 },
  briefing: { budget_tokens: 4000, max_handoffs: 2 },
  retrieval: {
    mode: "hybrid",
    fusion: "weighted",
    embeddings: { provider: "local", model: "auto", endpoint: null, allow_remote: false },
    rerank: "none",
    query_rewrite: "none",
    llm: { provider: "none", endpoint: null, model: null },
  },
  connectors: { google: { inbox_folder_id: null } },
  claims: { ttl_minutes: 180, heartbeat_minutes: 20 },
  server: { url: "https://aimem.example.com", project_id: "acme-platform" },
};

describe("projectSchema (03 §6)", () => {
  it("parses the full example unchanged", () => {
    expect(projectSchema.parse(full)).toEqual(full);
  });

  it("parses a minimal file without injecting defaults", () => {
    expect(projectSchema.parse({ aimem: 1, project: "demo" })).toEqual({ aimem: 1, project: "demo" });
  });

  it.each([
    ["mode", "duo"],
    ["sync", "ftp"],
    ["project", "Acme Platform"],
    ["write_policy", { agent_commits: "push" }],
    ["retrieval", { mode: "semantic" }],
    ["retrieval", { embeddings: { provider: "cloud" } }],
    ["claims", { ttl_minutes: -1 }],
    ["roles", []],
    ["adapters", { targets: ["vscode"] }],
  ])("rejects %s = %j", (key, value) => {
    expect(projectSchema.safeParse({ aimem: 1, project: "demo", [key]: value }).success).toBe(false);
  });

  it("accepts the adapters section (slice 2.5)", () => {
    const cfg = {
      aimem: 1,
      project: "demo",
      adapters: { targets: ["agents", "claude", "cursor", "copilot", "gemini"], files: ["docs/AI.md"] },
    };
    expect(projectSchema.parse(cfg)).toEqual(cfg);
  });

  it("rejects missing aimem or project", () => {
    expect(projectSchema.safeParse({ project: "demo" }).success).toBe(false);
    expect(projectSchema.safeParse({ aimem: 1 }).success).toBe(false);
  });

  it("preserves unknown keys at every level", () => {
    const input = {
      ...full,
      future: true,
      retrieval: { ...full.retrieval, extra: 1 },
      connectors: { odoo: { url: "x" } },
    };
    expect(projectSchema.parse(input)).toEqual(input);
  });
});
