/** The record example from 03 §2. */
export const specExample = {
  aimem: 1,
  id: "dec-7k3m9q2x",
  type: "decision",
  title: "Use Postgres for the ledger",
  summary: "Ledger data lives in Postgres, not Mongo, for transactions and reporting joins.",
  status: "accepted",
  trust: "verified",
  roles: ["dev", "db", "devops"],
  tags: ["database", "ledger"],
  repo: "backend",
  paths: ["services/ledger/**", "db/migrations/**"],
  author: "human:akbar",
  created: "2026-10-08T07:12:00Z",
  updated: "2026-10-08T07:12:00Z",
  verified: "2026-10-08",
  links: ["tsk-3f9a1b2c", "acme-platform:inc-8d2e4f6a"],
  supersedes: "dec-2a4b6c8d",
} as const;

/** Minimal valid frontmatter for any type. */
export function minimal(type: string, prefix: string, status: string): Record<string, unknown> {
  return {
    aimem: 1,
    id: `${prefix}-0123abcd`,
    type,
    title: "A title",
    summary: "A one-line summary.",
    status,
    trust: "agent",
    roles: ["dev"],
    author: "agent:claude-code",
    created: "2026-10-08T07:12:00Z",
    updated: "2026-10-08T07:12:00Z",
  };
}

export const validSource = {
  system: "google-doc",
  id: "doc-1",
  url: "https://docs.google.com/document/d/doc-1",
  version: "12",
  content_sha: "abc123",
  synced_at: "2026-10-12T03:00:00Z",
  imported_by: "human:akbar",
  state: "ok",
};
