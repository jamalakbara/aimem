import { decodeXml, unzipSome } from "./xlsx.js";

/** Text of a document is capped: one record should not hold a book (16 §7). */
const MAX_TEXT_CHARS = 2 * 1024 * 1024;

const cellText = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

/** Plain text that starts like markdown structure (#, -, >, ```, |) is escaped, so it stays text (QA, #102). */
const escapeLead = (text: string) =>
  text
    .split("\n")
    .map((l) => (/^\s*(#|-|>|```|\||\+|\*|\d+[.)]\s)/.test(l) ? `\\${l.trimStart()}` : l))
    .join("\n");

/** Text of one paragraph: runs, tabs and breaks in order; deleted (tracked) text and field codes left out. */
function paragraphText(xml: string): string {
  const live = xml
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, "")
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "");
  let out = "";
  for (const m of live.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

/** Heading level from the paragraph style (`Title`, `Heading1`…`Heading6`, `heading 2`) or outline level. */
function headingLevel(pPr: string): number {
  const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(pPr)?.[1] ?? "";
  if (/^title$/i.test(style)) return 1;
  const h = /^heading\s?([1-6])$/i.exec(style);
  if (h) return Number(h[1]) + 1;
  const outline = /<w:outlineLvl\b[^>]*w:val="(\d)"/.exec(pPr)?.[1];
  return outline !== undefined && Number(outline) < 6 ? Number(outline) + 2 : 0;
}

/**
 * 16 §7: a Word document as markdown, read with the same bounded unzip as xlsx (limits checked while
 * inflating, unsafe entry names and DTDs refused, nothing written to disk). Headings, lists, tables,
 * tabs and breaks are kept; images, comments and tracked deletions are left out. Nothing is run.
 */
export function readDocx(data: Uint8Array): { text: string; macros: boolean } {
  const { files, names } = unzipSome(data, (n) => n === "word/document.xml", "docx");
  const bytes = files.get("word/document.xml");
  if (!bytes) throw new Error("not a docx file (no word/document.xml)");
  const xml = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("word/document.xml contains a DTD or entity declaration; refused");
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? "";
  const blocks: string[] = [];
  let list = false;
  // Many people style the document title as Heading 1 rather than Title: the first heading then
  // becomes the title, so the Roles:/Tags: lines under it are read (QA, #102).
  const hasTitle = /<w:pStyle\b[^>]*w:val="Title"/i.test(body);
  let firstHeading = true;
  for (const m of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const el = m[0];
    if (el.startsWith("<w:tbl")) {
      const rows = [...el.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
          cellText(
            [...c[0].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
              .map((x) => paragraphText(x[1] ?? "").trim())
              .filter(Boolean)
              .join("\n"),
          ),
        ),
      );
      if (!rows.length) continue;
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      blocks.push([line(rows[0] ?? []), `|${"---|".repeat(width)}`, ...rows.slice(1).map(line)].join("\n"));
      list = false;
      continue;
    }
    const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(el)?.[0] ?? "";
    const text = paragraphText(el.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, "")).trim();
    if (!text) {
      list = false;
      continue;
    }
    const level = headingLevel(pPr);
    const num = /<w:numPr\b/.test(pPr);
    if (level) {
      const lvl = !hasTitle && firstHeading ? 1 : level;
      firstHeading = false;
      blocks.push(`${"#".repeat(Math.min(lvl, 6))} ${text.replace(/\s+/g, " ")}`);
      list = false;
    } else if (num) {
      const depth = Number(/<w:ilvl\b[^>]*w:val="(\d+)"/.exec(pPr)?.[1] ?? 0);
      const item = `${"  ".repeat(Math.min(depth, 8))}- ${escapeLead(text)}`;
      // Consecutive list items stay one block.
      if (list) blocks[blocks.length - 1] += `\n${item}`;
      else blocks.push(item);
      list = true;
    } else {
      blocks.push(escapeLead(text));
      list = false;
    }
  }
  const text = blocks.join("\n\n");
  if (text.length > MAX_TEXT_CHARS)
    throw new Error("the document text is larger than 2 MB; split it into smaller documents");
  return { text, macros: names.has("word/vbaProject.bin") };
}
