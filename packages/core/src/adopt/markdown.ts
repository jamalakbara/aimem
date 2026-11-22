/** Minimal markdown helpers for adopt extractors: front matter, headings outside code fences. */

export interface Section {
  level: number;
  heading: string;
  /** Text under the heading up to the next heading of any level, trimmed. */
  text: string;
  /** 1-based line in the file where `text` starts. */
  line: number;
}

export interface ParsedMarkdown {
  frontMatter: Record<string, string>;
  /** Title of the first `#` heading, if any. */
  title?: string;
  /** Text before the first heading (after front matter and the title), trimmed. */
  intro: string;
  introLine: number;
  sections: Section[];
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function parseMarkdown(text: string): ParsedMarkdown {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const frontMatter: Record<string, string> = {};
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(l);
        if (m?.[1]) frontMatter[m[1].toLowerCase()] = (m[2] ?? "").replace(/^["']|["']$/g, "");
      }
      i = end + 1;
    }
  }
  let title: string | undefined;
  const blocks: { level: number; heading: string; start: number; body: string[] }[] = [];
  let current: { level: number; heading: string; start: number; body: string[] } = {
    level: 0,
    heading: "",
    start: i + 1,
    body: [],
  };
  let fenced = false;
  for (; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (FENCE.test(l)) fenced = !fenced;
    const h = fenced ? null : HEADING.exec(l);
    if (h?.[1] && h[2]) {
      blocks.push(current);
      const level = h[1].length;
      if (level === 1 && title === undefined && blocks.every((b) => b.level === 0)) {
        title = h[2];
        current = { level: 0, heading: "", start: i + 2, body: [] };
      } else current = { level, heading: h[2], start: i + 2, body: [] };
      continue;
    }
    current.body.push(l);
  }
  blocks.push(current);
  const trimmed = (b: (typeof blocks)[number]) => {
    const lead = b.body.findIndex((l) => l.trim() !== "");
    return {
      text: b.body.join("\n").trim(),
      line: b.start + Math.max(lead, 0),
    };
  };
  const intro = blocks.filter((b) => b.level === 0).at(-1);
  return {
    frontMatter,
    ...(title !== undefined ? { title } : {}),
    intro: intro ? trimmed(intro).text : "",
    introLine: intro ? trimmed(intro).line : 1,
    sections: blocks
      .filter((b) => b.level > 0)
      .map((b) => ({ level: b.level, heading: b.heading, ...trimmed(b) })),
  };
}

/** First sentence of the first paragraph, list markers and emphasis removed, at most 200 chars. */
export function firstSentence(text: string): string {
  const para = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !FENCE.test(p));
  if (!para) return "";
  const flat = para
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .join(" ")
    // Strip markup, not identifiers: `scanned_at` keeps its underscore.
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, "$1$2");
  const m = /^(.+?[.!?])(?:\s|$)/.exec(flat);
  const s = (m?.[1] ?? flat).trim();
  return s.length > 200 ? `${s.slice(0, 197).trimEnd()}…` : s;
}
