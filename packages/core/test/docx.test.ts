import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { documentToRecord, readDocx } from "../src/index.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text: string, style?: string, extra = "") =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx = (body: string, extra: Record<string, Uint8Array> = {}) =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    ),
    ...extra,
  });

describe("docx reader (M4b.3a)", () => {
  it("turns headings, lists, tables, tabs and breaks into markdown; drops deleted text", () => {
    const body =
      p("Store events for 90 days", "Title") +
      p("Context", "Heading1") +
      `<w:p><w:r><w:t>Events grow</w:t></w:r><w:r><w:tab/><w:t>fast</w:t></w:r><w:del><w:r><w:delText>OLD</w:delText></w:r></w:del><w:r><w:br/><w:t>&amp; slow &lt;down&gt;.</w:t></w:r></w:p>` +
      p("Decision", "Heading1") +
      p("Keep 90 days.", undefined, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
      p("Archive the rest.", undefined, '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>') +
      p("Consequences", "Heading2") +
      `<w:tbl><w:tr><w:tc>${p("Option")}</w:tc><w:tc>${p("Cost")}</w:tc></w:tr><w:tr><w:tc>${p("A|B")}</w:tc><w:tc>${p("low")}${p("really")}</w:tc></w:tr></w:tbl>`;
    const r = readDocx(docx(body));
    expect(r.text).toBe(
      [
        "# Store events for 90 days",
        "",
        "## Context",
        "",
        "Events grow\tfast\n& slow <down>.",
        "",
        "## Decision",
        "",
        "- Keep 90 days.",
        "  - Archive the rest.",
        "",
        "### Consequences",
        "",
        "| Option | Cost |",
        "|---|---|",
        "| A\\|B | low<br>really |",
      ].join("\n"),
    );
    expect(r.macros).toBe(false);
  });

  it("feeds the decision template", () => {
    const body = [
      "Use Postgres",
      "Context",
      "We need storage.",
      "Decision",
      "Postgres 16.",
      "Consequences",
      "One store.",
    ]
      .map((t, i) => p(t, i === 0 ? "Title" : i % 2 ? "Heading1" : undefined))
      .join("");
    const rec = documentToRecord(readDocx(docx(body)).text, "d.docx");
    expect(rec).toMatchObject({ type: "decision", title: "Use Postgres", mode: "template" });
  });

  it("refuses XXE, bombs and unsafe entries, and flags macros", () => {
    const xxe = zipSync({
      "word/document.xml": strToU8('<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document/>'),
    });
    expect(() => readDocx(xxe)).toThrow(/contains a DTD or entity declaration/);
    const bomb = zipSync({ "word/document.xml": new Uint8Array(30 * 1024 * 1024).fill(32) }, { level: 9 });
    expect(() => readDocx(bomb)).toThrow(/unpacks to more than 20 MB/);
    expect(() => readDocx(docx("", { "../evil": strToU8("x") }))).toThrow(/unsafe entry name/);
    expect(() => readDocx(strToU8("nope"))).toThrow(/not a docx file/);
    expect(() => readDocx(zipSync({ "a.txt": strToU8("x") }))).toThrow(
      /not a docx file \(no word\/document\.xml\)/,
    );
    expect(readDocx(docx(p("Hi"), { "word/vbaProject.bin": strToU8("m") })).macros).toBe(true);
  });
});

describe("docx follow-ups (QA #102)", () => {
  it("reads Roles:/Tags: under a title styled Heading 1, and keeps that heading as the title", () => {
    const body =
      p("Keep events 90 days", "Heading1") +
      p("Roles: dev, qa") +
      p("Tags: one, two") +
      p("Context", "Heading1") +
      p("Why.") +
      p("Decision", "Heading1") +
      p("What.") +
      p("Consequences", "Heading1") +
      p("So.");
    const rec = documentToRecord(readDocx(docx(body)).text, "d.docx");
    expect(rec).toMatchObject({
      type: "decision",
      title: "Keep events 90 days",
      roles: ["dev", "qa"],
      tags: ["one", "two"],
    });
  });

  it("escapes markdown markers at the start of plain paragraphs, so text cannot fake structure", () => {
    const body =
      p("Notes", "Title") +
      p("# Fake heading") +
      p("## Context") +
      p("- not a list") +
      p("> quote") +
      p("```") +
      p("| pipe");
    const r = readDocx(docx(body));
    expect(r.text).toBe(
      [
        "# Notes",
        "\\# Fake heading",
        "\\## Context",
        "\\- not a list",
        "\\> quote",
        "\\```",
        "\\| pipe",
      ].join("\n\n"),
    );
    expect(documentToRecord(r.text, "n.docx").mode).toBe("whole-document");
  });
});
