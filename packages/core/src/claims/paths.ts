import { AimemError } from "../errors.js";
import { toPosix } from "../util/path.js";

export const MAX_CLAIM_PATHS = 32;
export const MAX_CLAIM_PATH_LENGTH = 256;

const GLOB_CHARS = /[*?[{]/;

function invalidPath(path: string): boolean {
  if (!path || path.length > MAX_CLAIM_PATH_LENGTH || /\p{Cc}/u.test(path)) return true;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return true;
  return path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/** Validate claim paths as repo-relative POSIX globs (07 §2.1). Duplicates are removed in order. */
export function normalizeClaimPaths(paths: readonly string[]): string[] {
  if (paths.length === 0) throw new AimemError("USAGE", "Provide one or more claim paths.");
  const normalized = [...new Set(paths.map((path) => toPosix(path.trim())))];
  if (normalized.length > MAX_CLAIM_PATHS) {
    throw new AimemError("USAGE", `Provide at most ${MAX_CLAIM_PATHS} claim paths.`);
  }
  const invalid = normalized.find(invalidPath);
  if (invalid !== undefined) {
    throw new AimemError(
      "USAGE",
      `Claim paths must be repo-relative, without '.' or '..' segments, and at most ${MAX_CLAIM_PATH_LENGTH} characters.`,
    );
  }
  return normalized;
}

/** The leading segments of a glob before its first wildcard segment. */
export function staticPrefix(glob: string): string[] {
  const segments = glob.split("/");
  const wildcard = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  return wildcard === -1 ? segments : segments.slice(0, wildcard);
}

/**
 * Approximate overlap: one static prefix equals the other or is a whole-segment ancestor of it.
 * False positives are acceptable because overlap only produces a warning.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const left = staticPrefix(a);
  const right = staticPrefix(b);
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.every((segment, index) => segment === longer[index]);
}

export function anyPathOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((left) => b.some((right) => pathsOverlap(left, right)));
}
