import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readXlsx, writeXlsx } from "../src/index.js";

const CT =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const WB = (sheets: string[]) =>
  `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
const RELS = (n: number) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from(
    { length: n },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("")}</Relationships>`;
const book = (sheets: Record<string, string>, extra: Record<string, Uint8Array> = {}) => {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CT),
    "xl/workbook.xml": strToU8(WB(names)),
    "xl/_rels/workbook.xml.rels": strToU8(RELS(names.length)),
    ...extra,
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheets[n]}</sheetData></worksheet>`,
    );
  });
  return zipSync(files);
};

describe("xlsx reader (M4b.2b)", () => {
  it("reads shared and inline strings, numbers, booleans, gaps and cached formula values", () => {
    const shared = strToU8(
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>title</t></si><si><r><t>sum</t></r><r><t>mary</t></r></si><si><t xml:space="preserve">A &amp; B &lt;ok&gt;</t></si></sst>',
    );
    const data =
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>done</t></is></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42.5</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><f>SUM(B2,1)</f><v>43.5</v></c></row>' +
      '<row r="4"><c r="A4" t="str"><f>CONCAT("a","b")</f></c><c r="B4" t="e"><v>#DIV/0!</v></c></row>';
    const r = readXlsx(book({ Tasks: data }, { "xl/sharedStrings.xml": shared }));
    expect(r.sheet).toBe("Tasks");
    expect(r.rows).toEqual([
      ["title", "summary", "", "done"],
      ["A & B <ok>", "42.5", "TRUE", "43.5"],
      ['=CONCAT("a","b")', "#DIV/0!"],
    ]);
  });

  it("picks a sheet by name and lists the names when it is missing", () => {
    const b = book({
      First: '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>',
      Second: '<row r="1"><c r="A1" t="inlineStr"><is><t>b</t></is></c></row>',
    });
    expect(readXlsx(b, "Second").rows).toEqual([["b"]]);
    expect(() => readXlsx(b, "Third")).toThrow(/no sheet named 'Third' \(sheets: First, Second\)/);
  });

  it("round-trips a workbook written by writeXlsx", () => {
    const b = writeXlsx("tasks", [
      ["title", "summary"],
      ["Ship it", 'Say "hi" & <go>'],
    ]);
    expect(readXlsx(b).rows).toEqual([
      ["title", "summary"],
      ["Ship it", 'Say "hi" & <go>'],
    ]);
  });
});

describe("xlsx safety (QA test plan)", () => {
  it("refuses a DTD or entity declaration (XXE)", () => {
    const evil = book(
      { S: '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>' },
      {
        "xl/sharedStrings.xml": strToU8(
          '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY x SYSTEM "file:///etc/passwd">]><sst><si><t>&x;</t></si></sst>',
        ),
      },
    );
    expect(() => readXlsx(evil)).toThrow(/contains a DTD or entity declaration/);
  });

  it("stops inflating an entry that unpacks past the limit (zip bomb)", () => {
    const bomb = book(
      { S: '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>' },
      { "xl/sharedStrings.xml": strToU8(`<sst>${" ".repeat(30 * 1024 * 1024)}</sst>`) },
    );
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => readXlsx(bomb)).toThrow(/unpacks to more than 20 MB/);
  });

  it("refuses entries with unsafe names and archives with too many entries", () => {
    const traversal = book({ S: "" }, { "../evil.xml": strToU8("x") });
    expect(() => readXlsx(traversal)).toThrow(/unsafe entry name '\.\.\/evil\.xml'/);
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 1100; i++) many[`xl/media/f${i}.bin`] = strToU8("x");
    expect(() => readXlsx(book({ S: "" }, many))).toThrow(/more than 1000 entries/);
  });

  it("refuses something that is not an xlsx file", () => {
    expect(() => readXlsx(strToU8("not a zip"))).toThrow(/not an xlsx file/);
    expect(() => readXlsx(zipSync({ "a.txt": strToU8("x") }))).toThrow(
      /not an xlsx file \(no xl\/workbook\.xml\)/,
    );
  });
});
