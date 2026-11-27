import type { IncomingMessage } from "node:http";
import type { Scope } from "./admin.js";
import type { Pool } from "./db.js";
import { HttpError, notFound, unauthenticated } from "./problem.js";
import { hashToken, TOKEN_RE } from "./token.js";

/** Who is asking, taken from the token alone; nothing in the body can change it (plan A4). */
export interface Caller {
  projectId: string;
  slug: string;
  userId: string;
  holder: string;
  onBehalfOf?: string;
  tokenId: string;
}

/** Raw header values by lower-case name: Node joins or drops repeated ones in `req.headers`. */
export function rawHeader(req: IncomingMessage, name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) out.push(req.rawHeaders[i + 1] ?? "");
  return out;
}

/** The order is fixed (plan §6.4): 401, then 404 for another project, then 403 for a missing scope. */
export async function authenticate(
  pool: Pool,
  req: IncomingMessage,
  slug: string,
  scope: Scope,
): Promise<Caller> {
  const values = rawHeader(req, "authorization");
  const match = values.length === 1 ? /^Bearer (\S+)$/.exec(values[0] ?? "") : null;
  const token = match?.[1];
  if (!token || !TOKEN_RE.test(token)) throw unauthenticated();
  const r = await pool.query(
    `SELECT t.id, t.kind, t.name, t.scopes, t.user_id, p.id AS project_id, p.slug, u.handle,
            (m.user_id IS NOT NULL) AS member
       FROM tokens t
       JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.user_id
       LEFT JOIN memberships m ON m.project_id = t.project_id AND m.user_id = t.user_id
      WHERE t.hash = $1 AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > clock_timestamp())`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) throw unauthenticated();
  // A token belongs to one project: another project is "not found", also for a member of both (QA W4).
  if (row.slug !== slug || !row.member) throw notFound();
  if (!(row.scopes as string[]).includes(scope))
    throw new HttpError(403, "PERMISSION_DENIED", `This token does not have the ${scope} scope.`);
  pool
    .query("UPDATE tokens SET last_used_at = clock_timestamp() WHERE id = $1", [row.id])
    .catch(() => undefined);
  const human = `human:${row.handle}`;
  return {
    projectId: String(row.project_id),
    slug: row.slug,
    userId: String(row.user_id),
    tokenId: String(row.id),
    ...(row.kind === "agent" ? { holder: `agent:${row.name}`, onBehalfOf: human } : { holder: human }),
  };
}
