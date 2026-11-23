import type { RecordType } from "@aimem/schema";
import { firstSentence, parseMarkdown, type Section } from "../adopt/markdown.js";

/** A document turned into one record (16 §4.2), before it is written. */
export interface DocumentRecord {
  type: RecordType;
  title: string;
  summary: string;
  body: string;
  status?: string;
  roles?: string[];
  tags?: string[];
  fields?: Record<string, unknown>;
  mode: "template" | "whole-document";
  /** Why the document fell back to whole-document mode. */
  warning?: string;
  /** Other things the import left out or changed (bad tags/roles, front matter). */
  notes?: string[];
}

type TemplateType = "decision" | "runbook" | "incident" | "memory";

/** 16 §4.2: required headings per template (Summary is optional everywhere except memory). */
const REQUIRED: Record<TemplateType, string[]> = {
  decision: ["Context", "Decision", "Consequences"],
  runbook: ["When to use", "Steps", "Rollback", "Verify"],
  incident: ["Impact", "Timeline", "Root cause", "Fix", "Prevention"],
  memory: ["Summary"],
};
const OPTIONAL: Partial<Record<TemplateType, string[]>> = { decision: ["Alternatives"] };
const TEMPLATE_TYPES: TemplateType[] = ["decision", "runbook", "incident", "memory"];
const META = /^\s*(roles|tags)\s*:\s*(.+)$/gim;

/** Terminal escapes and other control characters never reach titles, summaries or names (QA, #99). */
const stripControl = (s: string) =>
  [...s]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return c === "\t" || c === "\n" || (code >= 32 && code !== 127);
    })
    .join("");
const key = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function decisionStatus(raw: string | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (/supersed/.test(s)) return "superseded";
  if (/deprecat/.test(s)) return "deprecated";
  if (/reject|declin/.test(s)) return "rejected";
  if (/accept|approved|agreed|done/.test(s)) return "accepted";
  return "proposed";
}

/**
 * 16 §4.2: a document with the headings of a template becomes a typed record; anything else becomes
 * one `memory` (`kind: reference`) holding the whole text ("whole document" mode, 16 §3.1).
 */
export function documentToRecord(text: string, fileName: string, typeHint?: string): DocumentRecord {
  const notes: string[] = [];
  let clean = stripControl(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  // Front matter at the top is metadata of the source document, not content (and never ours).
  const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(clean);
  if (fm) {
    clean = clean.slice(fm[0].length).trim();
    notes.push("front matter at the top of the document was left out");
  }
  const md = parseMarkdown(clean);
  const sections = new Map<string, Section>();
  for (const s of md.sections) if (!sections.has(key(s.heading))) sections.set(key(s.heading), s);
  const meta: Record<string, string[]> = {};
  for (const m of md.intro.matchAll(META))
    meta[(m[1] ?? "").toLowerCase()] = (m[2] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const fallbackTitle = fileName.replace(/\.[^.]+$/, "");
  const firstLine = clean
    .split("\n")
    .find((l) => l.trim())
    ?.replace(/^#+\s*/, "")
    .trim();
  const title = clip(
    stripControl((md.title ?? firstLine ?? fallbackTitle).replace(/[*_`]/g, "")).trim() || fallbackTitle,
    120,
  );
  const sectionText = (h: string) => sections.get(key(h))?.text ?? "";
  const summaryFrom = (fallback: string) =>
    clip(stripControl(firstSentence(sectionText("Summary")) || firstSentence(fallback) || title), 200);

  const hint = typeHint?.toLowerCase();
  const candidates =
    hint && (TEMPLATE_TYPES as string[]).includes(hint) ? [hint as TemplateType] : TEMPLATE_TYPES;
  const match = candidates.find((t) => REQUIRED[t].every((h) => sections.has(key(h))));
  // Roles and tags become frontmatter: keep only safe names, and say what was left out.
  const keepNames = (list: string[] | undefined, re: RegExp, what: string) => {
    const ok = (list ?? []).filter((x) => re.test(x));
    const bad = (list ?? []).filter((x) => !re.test(x));
    if (bad.length) notes.push(`ignored ${what}: ${bad.map(stripControl).join(", ")}`);
    return ok;
  };
  const roles = keepNames(meta.roles, /^[a-z0-9][a-z0-9_-]*$/i, "roles");
  const tags = keepNames(
    meta.tags?.map((t) => t.toLowerCase().replace(/\s+/g, "-")),
    /^[a-z0-9][a-z0-9-]*$/,
    "tags",
  );
  const common = {
    ...(roles.length ? { roles } : {}),
    ...(tags.length ? { tags } : {}),
    ...(notes.length ? { notes } : {}),
  };

  if (match && match !== "memory") {
    const heads = [...REQUIRED[match], ...(OPTIONAL[match] ?? []).filter((h) => sections.has(key(h)))];
    const body = heads
      .map((h) => `## ${h}\n\n${sectionText(h) || "_Not stated in the document._"}`)
      .join("\n\n");
    const severity = /\bsev[1-4]\b/i.exec(sectionText("Severity"))?.[0]?.toLowerCase();
    return {
      type: match,
      title,
      summary: summaryFrom(sectionText(REQUIRED[match][0] ?? "")),
      body,
      ...(match === "decision" ? { status: decisionStatus(sectionText("Status").split("\n")[0]) } : {}),
      ...(severity ? { fields: { severity } } : {}),
      ...common,
      mode: "template",
    };
  }
  if (match === "memory") {
    const rest = md.sections
      .filter((s) => key(s.heading) !== "summary")
      .map((s) => `${"#".repeat(s.level)} ${s.heading}\n\n${s.text}`.trim());
    const body =
      [md.intro.replace(META, "").trim(), ...rest].filter(Boolean).join("\n\n") || sectionText("Summary");
    return { type: "memory", title, summary: summaryFrom(body), body, ...common, mode: "template" };
  }

  const missing =
    hint && (TEMPLATE_TYPES as string[]).includes(hint)
      ? REQUIRED[hint as TemplateType].filter((h) => !sections.has(key(h)))
      : [];
  const afterTitle = clean.split("\n").slice(1).join("\n").replace(META, "").trim();
  return {
    type: "memory",
    title,
    summary: summaryFrom(afterTitle || clean),
    body: clean,
    fields: { kind: "reference" },
    ...common,
    mode: "whole-document",
    warning: missing.length
      ? `missing headings for ${hint}: ${missing.join(", ")}; imported as a whole document`
      : "no template matched; imported as a whole document",
  };
}
