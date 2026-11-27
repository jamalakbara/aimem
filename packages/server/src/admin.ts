import { baseFrontmatterSchema, PROJECT_SLUG_RE } from "@aimem/schema";
import { inTx, type Pool } from "./db.js";
import { hashToken, newToken } from "./token.js";

export const SCOPES = ["read", "write:live", "admin"] as const;
export type Scope = (typeof SCOPES)[number];

export interface NewTokenInput {
  project: string;
  /** Project name, used only when the project is created. */
  projectName?: string;
  user: string;
  kind: "human" | "agent";
  /** Agent name; a human token is named after its user. */
  name?: string;
  scopes: readonly string[];
  expiresAt?: Date;
}

const NAME = /^[^\s:]{1,64}$/;
/** The same rule as record authors (`human:<handle>`, `agent:<tool>`), without control characters. */
function validAuthor(author: string): boolean {
  return !/\p{Cc}/u.test(author) && baseFrontmatterSchema.shape.author.safeParse(author).success;
}

/**
 * Operator command (plan A6): creates the project, user and membership when missing, then a token.
 * The token is returned once; only its hash is stored.
 */
export async function createToken(pool: Pool, input: NewTokenInput): Promise<{ id: string; token: string }> {
  if (!PROJECT_SLUG_RE.test(input.project)) throw new Error("project must be a lowercase kebab slug");
  if (!NAME.test(input.user) || !validAuthor(`human:${input.user}`)) throw new Error("invalid user handle");
  const name = input.kind === "agent" ? (input.name ?? "") : input.user;
  if (input.kind === "agent" && (!NAME.test(name) || !validAuthor(`agent:${name}`)))
    throw new Error("invalid agent name");
  if (input.kind !== "agent" && input.name !== undefined && input.name !== input.user)
    throw new Error("a human token is named after its user");
  const unknown = input.scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (unknown.length) throw new Error(`unknown scope: ${unknown.join(", ")}`);
  const token = newToken();
  const id = await inTx(pool, async (c) => {
    await c.query("INSERT INTO projects (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", [
      input.project,
      input.projectName ?? input.project,
    ]);
    const project = (await c.query("SELECT id FROM projects WHERE slug = $1", [input.project])).rows[0].id;
    await c.query("INSERT INTO project_event_seq (project_id) VALUES ($1) ON CONFLICT DO NOTHING", [project]);
    await c.query("INSERT INTO users (handle) VALUES ($1) ON CONFLICT (handle) DO NOTHING", [input.user]);
    const user = (await c.query("SELECT id FROM users WHERE handle = $1", [input.user])).rows[0].id;
    await c.query("INSERT INTO memberships (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      project,
      user,
    ]);
    const row = await c.query(
      "INSERT INTO tokens (project_id, user_id, kind, name, hash, scopes, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [
        project,
        user,
        input.kind,
        name,
        hashToken(token),
        [...new Set(input.scopes)],
        input.expiresAt ?? null,
      ],
    );
    const tokenId = String(row.rows[0].id);
    await c.query(
      "INSERT INTO audit_log (project_id, actor, action, target, meta) VALUES ($1, 'operator', 'token.create', $2, $3)",
      [project, tokenId, { kind: input.kind, name, user: input.user, scopes: input.scopes }],
    );
    return tokenId;
  });
  return { id, token };
}

export async function revokeToken(pool: Pool, id: string): Promise<boolean> {
  return inTx(pool, async (c) => {
    const r = await c.query(
      "UPDATE tokens SET revoked_at = clock_timestamp() WHERE id = $1 AND revoked_at IS NULL RETURNING project_id",
      [id],
    );
    if (!r.rowCount) return false;
    await c.query(
      "INSERT INTO audit_log (project_id, actor, action, target) VALUES ($1, 'operator', 'token.revoke', $2)",
      [r.rows[0].project_id, id],
    );
    return true;
  });
}
