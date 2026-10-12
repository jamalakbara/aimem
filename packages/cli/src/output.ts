import type { ErrorCode } from "@aimem/schema";

/** 04 §1 / §7: exit code per error code. */
export const EXIT_CODES: Record<ErrorCode, number> = {
  NOT_FOUND: 1,
  NOT_INITIALIZED: 2,
  INVALID_RECORD: 2,
  PERMISSION_DENIED: 2,
  SECRET_DETECTED: 2,
  SPEC_TOO_NEW: 2,
  READONLY_EXTERNAL: 2,
  SOURCE_AUTH: 2,
  USAGE: 2,
  DUPLICATE_LIKELY: 3,
  CLAIM_CONFLICT: 3,
  SYNC_FAILED: 4,
  SOURCE_UNREACHABLE: 4,
};

export function successEnvelope(command: string, data: unknown, warnings: string[]): string {
  return `${JSON.stringify({ ok: true, command, data, warnings })}\n`;
}

export function failureEnvelope(code: string, message: string, details?: Record<string, unknown>): string {
  return `${JSON.stringify({ ok: false, error: { code, message, ...(details ? { details } : {}) } })}\n`;
}

/** Left-aligned columns separated by two spaces. */
export function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return `${[line(header), ...rows.map(line)].join("\n")}\n`;
}
