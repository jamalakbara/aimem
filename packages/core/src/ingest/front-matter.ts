/**
 * Front matter at the top of an imported text: `---`, then only `key: value`, list or indented lines,
 * then `---`. A document that just starts with a horizontal rule keeps all its text (#106).
 */
export function splitFrontMatter(text: string): { text: string; found: boolean } {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  const lines = m?.[1]?.split("\n") ?? [];
  const yaml =
    /^[\w-]+\s*:/.test(lines[0] ?? "") &&
    lines.every((l) => l.trim() === "" || /^([\w-]+\s*:|\s+\S|- )/.test(l));
  return m && yaml ? { text: text.slice(m[0].length).trim(), found: true } : { text, found: false };
}
