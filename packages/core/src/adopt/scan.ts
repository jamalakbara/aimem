import { join } from "node:path";
import type { Fs } from "../ports.js";
import { slugify } from "../records/ids.js";
import { scanSecrets } from "../secrets/scan.js";
import { firstSentence, parseMarkdown, type Section } from "./markdown.js";
import type { AdoptCandidate, AdoptSkip, AdoptSource, ScanResult } from "./types.js";
import { IMPLEMENTED_SOURCES } from "./types.js";

/** 08 §4: files over this size are skipped. */
export const ADOPT_MAX_FILE_BYTES = 200 * 1024;

const SKIP_DIRS = new Set([
  ".git",
  ".aimem",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".next",
  ".venv",
  "venv",
  "target",
  "__pycache__",
]);
const MARKDOWN = /\.(md|mdx|markdown|mdc)$/i;
const ADR_DIR = /^(?:docs?\/)?(?:adr|adrs|decisions)\//i;
const README = /^readme\.(md|markdown|mdx)$/i;
const AGENT_FILES =
  /^(?:CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.github\/copilot-instructions\.md|\.cursor\/rules\/.+\.(?:md|mdc))$/;
/** Sections of README/docs that describe how to run, test or ship the project (08 §2.1). */
const HOWTO =
  /\b(getting started|quick ?start|install(?:ation|ing)?|setup|set up|^usage$|run(?:ning)?|test(?:s|ing)?|build(?:ing)?|deploy(?:ment|ing)?|release|develop(?:ment|ing)?|local dev\w*)\b/i;
const PREFERENCE = /\b(never|always|must|do not|don't|prefer|only|avoid)\b/i;
const AIMEM_BLOCK = /<!-- aimem:begin v\d+ -->[\s\S]*?<!-- aimem:end -->\n?/g;

export interface ScanOptions {
  /** Defaults to every implemented source (22 §4.1). */
  sources?: readonly AdoptSource[];
  /** Fingerprints from `.aimem/secretignore`. */
  secretIgnore?: ReadonlySet<string>;
}

/** Every file under `root` (relative, `/`-separated, sorted), skipping build output and VCS dirs. */
async function walk(fs: Fs, root: string): Promise<string[]> {
  if (!fs.stat) throw new Error("adopt needs a filesystem with stat");
  const stat = fs.stat.bind(fs);
  const out: string[] = [];
  const visit = async (rel: string) => {
    const names = (await fs.readdir(rel ? join(root, rel) : root)).sort();
    for (const name of names) {
      const path = rel ? `${rel}/${name}` : name;
      const s = await stat(join(root, path)).catch(() => undefined);
      if (!s) continue;
      if (s.isDirectory) {
        if (!SKIP_DIRS.has(name)) await visit(path);
      } else out.push(path);
    }
  };
  await visit("");
  return out.sort();
}

const anchor = (path: string, heading: string) => `${path}#${slugify(heading)}`;
/** Drops markdown emphasis and leading section numbers ("2. ", "3.3 — "). */
const cleanTitle = (t: string) =>
  t
    .replace(/[*_`]/g, "")
    .replace(/^\d+(?:\.\d+)*\.?\s*(?:[—–-]\s*)?/, "")
    .trim()
    .slice(0, 120);

/** ADR status words → decision statuses (03 §4). Unknown or missing → proposed (08 §2.1 Phase C). */
function adrStatus(raw: string | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (/supersed/.test(s)) return "superseded";
  if (/deprecat/.test(s)) return "deprecated";
  if (/reject|declin/.test(s)) return "rejected";
  if (/accept|approved|adopted|done/.test(s)) return "accepted";
  return "proposed";
}

function adrCandidate(path: string, text: string): AdoptCandidate {
  const md = parseMarkdown(text);
  const title = cleanTitle(
    (md.title ?? path.split("/").pop() ?? path)
      .replace(/^(?:ADR[-\s]?\d+[:.]?\s*|\d+[.:]\s*)/i, "")
      .replace(/\.md$/i, ""),
  );
  const statusSection = md.sections.find((s) => /^status$/i.test(s.heading));
  const statusLine = /^\s*(?:[-*]\s*)?status:\s*(.+)$/im.exec(md.intro)?.[1];
  const status = adrStatus(md.frontMatter.status ?? statusLine ?? statusSection?.text.split("\n")[0]);
  const pick = (re: RegExp) =>
    md.sections
      .filter((s) => re.test(s.heading))
      .map((s) => s.text)
      .filter(Boolean)
      .join("\n\n");
  const context = pick(/context|problem/i);
  const decision = pick(/^decision|outcome/i);
  const consequences = pick(/consequence/i);
  const missing = `_Not stated in ${path}._`;
  const body = [
    `## Context\n\n${context || missing}`,
    `## Decision\n\n${decision || missing}`,
    `## Consequences\n\n${consequences || missing}`,
  ].join("\n\n");
  return {
    source: "adr",
    type: "decision",
    title,
    summary: firstSentence(decision) || firstSentence(context) || title,
    body,
    status,
    tags: ["adopted"],
    evidence: [path],
  };
}

/** One memory per `##` section of an agent-instruction file, verbatim; the whole file when it has none. */
function agentCandidates(path: string, text: string): { candidate: AdoptCandidate; line: number }[] {
  const md = parseMarkdown(text.replace(AIMEM_BLOCK, ""));
  const paths = md.frontMatter.globs
    ?.split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const make = (title: string, body: string, line: number, evidence: string) => ({
    line,
    candidate: {
      source: "agents" as const,
      type: "memory" as const,
      title: cleanTitle(title),
      summary: firstSentence(body) || cleanTitle(title),
      body,
      kind: PREFERENCE.test(body) ? ("preference" as const) : ("howto" as const),
      tags: ["adopted", "imported"],
      ...(paths?.length ? { paths } : {}),
      evidence: [evidence],
    },
  });
  const top = md.sections.filter((s) => s.level === 2);
  if (top.length)
    return top
      .map((s) => ({ s, body: sectionWithChildren(md.sections, s) }))
      .filter(({ body }) => body)
      .map(({ s, body }) => make(s.heading, body, s.line, anchor(path, s.heading)));
  const body = [md.intro, ...md.sections.map((s) => `${"#".repeat(s.level)} ${s.heading}\n\n${s.text}`)]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!body) return [];
  const title = md.title ?? md.frontMatter.description ?? path.split("/").pop() ?? path;
  return [make(title, body, md.introLine, path)];
}

/** A section's text plus its deeper subsections, as written. */
function sectionWithChildren(all: Section[], s: Section): string {
  const parts = [s.text];
  for (const next of all.slice(all.indexOf(s) + 1)) {
    if (next.level <= s.level) break;
    parts.push(`${"#".repeat(next.level)} ${next.heading}\n\n${next.text}`.trim());
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

/** README → "Project overview" (pinned) plus how-to sections; docs → how-to sections only. */
function docCandidates(
  source: "readme" | "docs",
  path: string,
  text: string,
): { candidate: AdoptCandidate; line: number }[] {
  const md = parseMarkdown(text);
  const out: { candidate: AdoptCandidate; line: number }[] = [];
  if (source === "readme" && md.intro) {
    out.push({
      line: md.introLine,
      candidate: {
        source,
        type: "memory",
        title: "Project overview",
        summary: firstSentence(md.intro),
        body: md.intro,
        kind: "fact",
        tags: ["adopted", "pinned"],
        evidence: [path],
      },
    });
  }
  for (const s of md.sections.filter((x) => x.level === 2 && HOWTO.test(x.heading))) {
    const body = sectionWithChildren(md.sections, s);
    if (!body) continue;
    out.push({
      line: s.line,
      candidate: {
        source,
        type: "memory",
        title: cleanTitle(s.heading),
        summary: firstSentence(body) || cleanTitle(s.heading),
        body,
        kind: "howto",
        tags: ["adopted"],
        evidence: [anchor(path, s.heading)],
      },
    });
  }
  return out;
}

/**
 * Phase A of `aimem adopt` (08 §2.1): read the project and return draft candidates with evidence.
 * Deterministic and offline; writes nothing.
 */
export async function scanProject(fs: Fs, root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const wanted = new Set(opts.sources ?? IMPLEMENTED_SOURCES);
  const files = await walk(fs, root);
  const candidates: AdoptCandidate[] = [];
  const skipped: AdoptSkip[] = [];

  const classify = (path: string): AdoptSource | undefined => {
    if (AGENT_FILES.test(path)) return "agents";
    if (!MARKDOWN.test(path)) return undefined;
    if (ADR_DIR.test(path)) return "adr";
    if (README.test(path)) return "readme";
    if (/^docs?\//i.test(path)) return "docs";
    return undefined;
  };
  const bySource = new Map<AdoptSource, string[]>();
  for (const path of files) {
    const source = classify(path);
    if (source && wanted.has(source)) bySource.set(source, [...(bySource.get(source) ?? []), path]);
  }

  // Order follows the cap priority of 22 decision 4.
  for (const source of IMPLEMENTED_SOURCES) {
    for (const path of bySource.get(source) ?? []) {
      const bytes = await fs.readBytes(join(root, path));
      if (bytes.byteLength > ADOPT_MAX_FILE_BYTES) {
        skipped.push({ evidence: path, reason: "file larger than 200 KB" });
        continue;
      }
      const text = new TextDecoder().decode(bytes);
      const found =
        source === "adr"
          ? [{ candidate: adrCandidate(path, text), line: 1 }]
          : source === "agents"
            ? agentCandidates(path, text)
            : docCandidates(source as "readme" | "docs", path, text);
      for (const { candidate, line } of found) {
        const hit = scanSecrets(candidate.body, opts.secretIgnore)[0];
        if (hit) {
          skipped.push({
            evidence: candidate.evidence[0] ?? path,
            reason: `possible secret (${hit.kind}, line ${line + hit.line - 1})`,
          });
          continue;
        }
        candidates.push(candidate);
      }
    }
  }
  return { candidates, skipped };
}
