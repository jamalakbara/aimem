import type { ErrorCode } from "@aimem/schema";

/** Error with a stable code from 04 §7; the CLI maps codes to exit codes. */
export class AimemError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AimemError";
  }
}
