/** Text that is already HTML. Only `html` makes one, so a plain value can never pass as markup. */
class Safe {
  constructor(private readonly text: string) {}
  toString(): string {
    return this.text;
  }
}
export type Html = Safe;

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function show(v: unknown): string {
  if (v instanceof Safe) return v.toString();
  if (Array.isArray(v)) return v.map(show).join("");
  return v === null || v === undefined || v === false ? "" : escapeHtml(String(v));
}

/** Tagged template for pages: every value is escaped unless `html` made it. Quote attributes with `"`. */
export function html(parts: TemplateStringsArray, ...values: unknown[]): Html {
  return new Safe(parts.reduce((out, part, i) => out + show(values[i - 1]) + part));
}
