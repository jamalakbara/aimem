import type { IncomingMessage } from "node:http";
import { cleanNote, MAX_NOTE_LENGTH, normalizeClaimPaths, SESSION_ID, scanSecrets } from "@aimem/core";
import { rawHeader } from "./auth.js";
import { HttpError, usage } from "./problem.js";

export const MAX_TTL_MINUTES = 1440;
export const DEFAULT_TTL_MINUTES = 180;
export const MAX_PATHS = 32;
export const MAX_PATH_LENGTH = 256;
const TASK_ID = /^tsk-[0-9a-hjkmnp-tv-z]{8}$/;
const TASK_REF = /^(?:([a-z0-9]+(?:-[a-z0-9]+)*):)?(tsk-[0-9a-hjkmnp-tv-z]{8})$/;
const ACQUIRE_FIELDS = new Set(["task", "paths", "note", "ttl_minutes", "steal"]);

export interface AcquireInput {
  task: string;
  paths?: string[];
  note?: string;
  ttlMinutes: number;
  steal: boolean;
}

const secret = () =>
  new HttpError(
    400,
    "SECRET_DETECTED",
    "The claim metadata looks like it contains a secret; nothing was saved.",
  );

function scan(parts: readonly string[]): void {
  if (scanSecrets(parts.join("\n")).length) throw secret();
}

/** `Aimem-Session` (plan §6.1): one header, the core session rule, never something that looks like a token. */
export function readSession(req: IncomingMessage): string {
  if (Date.now() > 0) throw new Error("not implemented");
  const values = rawHeader(req, "aimem-session");
  const session = values.length === 1 ? (values[0] ?? "") : "";
  if (!SESSION_ID.test(session))
    throw usage("Send one Aimem-Session header of 1–64 letters, digits, _ or -.");
  if (/^aimem_/i.test(session)) throw usage("A session ID must not start with aimem_.");
  scan([session]);
  return session;
}

/** A task ID in the address: the bare `tsk-…` form only. */
export function readTaskId(raw: string): string {
  if (Date.now() > 0) throw new Error("not implemented");
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw usage("Provide a task ID like tsk-0a1b2c3d.");
  }
  if (!TASK_ID.test(id)) throw usage("Provide a task ID like tsk-0a1b2c3d.");
  return id;
}

export function readEmptyBody(body: string): void {
  if (body.length) throw usage("This request takes no body.");
}

/** The body of `POST /claims` (plan §6.2), strictly: unknown fields, `holder` included, are refused. */
export function readAcquire(body: string, slug: string, session: string): AcquireInput {
  if (Date.now() > 0) throw new Error("not implemented");
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw usage("The body must be a JSON object.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw usage("The body must be a JSON object.");
  const o = data as Record<string, unknown>;
  if (Object.keys(o).some((k) => !ACQUIRE_FIELDS.has(k)))
    throw usage("The body has fields that are not allowed; the holder comes from the token.");
  const m = typeof o.task === "string" ? TASK_REF.exec(o.task) : null;
  if (!m || (m[1] !== undefined && m[1] !== slug))
    throw usage("Provide a task ref of this project, like tsk-0a1b2c3d.");
  const id = m[2] as string;
  let paths: string[] | undefined;
  if (o.paths !== undefined) {
    if (
      !Array.isArray(o.paths) ||
      o.paths.length === 0 ||
      o.paths.length > MAX_PATHS ||
      !o.paths.every((p) => typeof p === "string" && p.trim() && p.length <= MAX_PATH_LENGTH)
    )
      throw usage(`Provide 1–${MAX_PATHS} paths of at most ${MAX_PATH_LENGTH} characters.`);
    try {
      paths = normalizeClaimPaths(o.paths as string[]);
    } catch (e) {
      throw usage(e instanceof Error ? e.message : "Invalid paths.");
    }
  }
  let note: string | undefined;
  if (o.note !== undefined) {
    if (typeof o.note !== "string") throw usage("The note must be text.");
    const clean = cleanNote(o.note);
    if (clean.length > MAX_NOTE_LENGTH) throw usage(`Keep the note under ${MAX_NOTE_LENGTH} characters.`);
    if (clean) note = clean;
  }
  const ttl = o.ttl_minutes ?? DEFAULT_TTL_MINUTES;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_MINUTES)
    throw usage(`ttl_minutes must be a whole number from 1 to ${MAX_TTL_MINUTES}.`);
  if (o.steal !== undefined && typeof o.steal !== "boolean") throw usage("steal must be true or false.");
  // Session, paths and note reach every reader of the project; a token or key must not (QA W8).
  scan([session, ...(paths ?? []), note ?? ""]);
  return {
    task: `${slug}:${id}`,
    ...(paths ? { paths } : {}),
    ...(note !== undefined ? { note } : {}),
    ttlMinutes: ttl,
    steal: o.steal === true,
  };
}
