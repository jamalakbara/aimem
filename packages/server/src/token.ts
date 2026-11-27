import { createHash, randomBytes } from "node:crypto";

/** `aimem_` and 32 random bytes as base64url without padding: 43 characters (plan A5, QA W8). */
export const TOKEN_RE = /^aimem_[A-Za-z0-9_-]{43}$/;

export const newToken = (): string => `aimem_${randomBytes(32).toString("base64url")}`;

/** Only this is stored; the token itself is shown once (09 §6). */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
