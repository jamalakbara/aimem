import type { ErrorCode } from "@aimem/schema";

/** A failed request as RFC 7807 problem+json with a stable 04 §7 `code` (plan §6.4). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail: string,
    readonly details?: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
    this.name = "HttpError";
  }
}

const TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Unauthenticated",
  403: "Permission denied",
  404: "Not found",
  409: "Conflict",
  413: "Request too large",
  500: "Server error",
  503: "Service unavailable",
};

export function problemBody(e: HttpError): string {
  return JSON.stringify({
    type: "about:blank",
    title: TITLES[e.status] ?? "Error",
    status: e.status,
    code: e.code,
    detail: e.detail,
    ...(e.details ? { details: e.details } : {}),
  });
}

export const notFound = () => new HttpError(404, "NOT_FOUND", "Not found.");
export const unauthenticated = () =>
  new HttpError(401, "UNAUTHENTICATED", "A valid bearer token is required.", undefined, {
    "WWW-Authenticate": 'Bearer realm="aimem"',
  });
export const usage = (detail: string) => new HttpError(400, "USAGE", detail);
