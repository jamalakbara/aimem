/**
 * Text from outside the notebook, made safe to show on a terminal: control characters, bidirectional
 * overrides and isolates (a name can otherwise display reversed) and invisible tag characters go; tabs,
 * newlines and the plain direction marks and joiners that real languages need stay (QA, #99, #106).
 */
export function cleanText(s: string): string {
  let out = "";
  for (const c of s) {
    const n = c.codePointAt(0) ?? 0;
    if (n < 32 ? c !== "\t" && c !== "\n" : n === 127) continue;
    if (
      n === 0xfeff ||
      (n >= 0x202a && n <= 0x202e) ||
      (n >= 0x2066 && n <= 0x2069) ||
      (n >= 0xe0000 && n <= 0xe007f)
    )
      continue;
    out += c;
  }
  return out;
}
