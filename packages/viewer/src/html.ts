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

/** Longest prefix of at most `max` UTF-16 units that does not end in half a character. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** The address when it is an absolute web or mail link without credentials (24 decision 2). */
export function safeExternalHref(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol === "mailto:") return url.href;
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return url.username || url.password ? undefined : url.href;
}
