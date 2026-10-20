/** Repo-relative paths are stored and printed with `/` on every platform (03 §10); Node's `path` uses `\` on Windows. */
export function toPosix(p: string): string {
  return p.split("\\").join("/");
}
