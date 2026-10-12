import type { ErrorCode } from "@aimem/schema";

export class AimemError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "AimemError";
  }
  /** CLI exit code (04 §1). */
  get exitCode(): number {
    switch (this.code) {
      case "NOT_FOUND": return 1;
      case "DUPLICATE_LIKELY": case "CLAIM_CONFLICT": return 3;
      case "SYNC_FAILED": case "SOURCE_UNREACHABLE": return 4;
      default: return 2;
    }
  }
}
