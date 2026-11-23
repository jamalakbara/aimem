import { strToU8, Unzip, UnzipInflate, zipSync } from "fflate";

/** Archive limits (QA test plan for M4b): checked while inflating, not from the zip headers. */
const MAX_ENTRIES = 1000;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const fail = (reason: string): never => {
  throw new Error(reason);
};

/** An entry name that could point outside the archive if anything ever extracted it. */
const unsafeName = (name: string) =>
  /^([a-z]:|[\\/])/i.test(name) || name.split(/[\\/]/).some((p) => p === "..");

/**
 * Inflates only the entries \`want\` accepts, counting real bytes as they arrive: a forged size in a zip
 * header cannot hide a zip bomb. Nothing is written to disk.
 */
function unzipSome(data: Uint8Array, want: (name: string) => boolean): Map<string, Uint8Array> {
  if (data[0] !== 0x50 || data[1] !== 0x4b) fail("not an xlsx file");
  const out = new Map<string, Uint8Array>();
  let entries = 0;
  let total = 0;
  let error: Error | undefined;
  const unzip = new Unzip((file) => {
    if (error) return;
    entries++;
    if (entries > MAX_ENTRIES) {
      error = new Error(`the archive has more than ${MAX_ENTRIES} entries`);
      return;
    }
    if (unsafeName(file.name)) {
      error = new Error(`unsafe entry name '${file.name}'`);
      return;
    }
    if (!want(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (error) return;
      if (err) {
        error = new Error(`could not unpack ${file.name}: ${err.message}`);
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
        error = new Error(`${file.name} unpacks to more than ${MAX_ENTRY_BYTES / 1024 / 1024} MB`);
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        const all = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          all.set(c, at);
          at += c.length;
        }
        out.set(file.name, all);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(data, true);
  } catch (e) {
    error ??= new Error(`not an xlsx file (${e instanceof Error ? e.message : String(e)})`);
  }
  if (error) throw error;
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name.replace(":", "\\:")}="([^"]*)"`).exec(tag)?.[1];
/** Text of every \`<t>\` in a fragment (rich-text runs joined); phonetic runs are left out. */
const texts = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => decodeXml(m[1] ?? ""))
    .join("");
const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "A") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * Rows of one worksheet as text (first sheet, or \`sheetName\`). Cells are never evaluated: a formula
 * gives its cached value, or \`=formula\` as text when the file has none. A DTD or entity declaration is
 * refused outright (no XXE).
 */
export function readXlsx(data: Uint8Array, sheetName?: string): { sheet: string; rows: string[][] } {
  const files = unzipSome(
    data,
    (n) =>
      n === "xl/workbook.xml" ||
      n === "xl/_rels/workbook.xml.rels" ||
      n === "xl/sharedStrings.xml" ||
      (n.startsWith("xl/worksheets/") && n.endsWith(".xml")),
  );
  const xml = (name: string) => {
    const bytes = files.get(name);
    if (!bytes) return undefined;
    const text = new TextDecoder().decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail(`${name} contains a DTD or entity declaration; refused`);
    return text;
  };
  const workbook = xml("xl/workbook.xml") ?? fail("not an xlsx file (no xl/workbook.xml)");
  const rels = xml("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], "Id") ?? "",
      attr(m[0], "Target") ?? "",
    ]),
  );
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeXml(attr(m[0], "name") ?? ""),
    target: targets.get(attr(m[0], "r:id") ?? "") ?? "",
  }));
  if (!sheets.length) fail("the workbook has no sheets");
  const chosen = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!chosen) fail(`no sheet named '${sheetName}' (sheets: ${sheets.map((s) => s.name).join(", ")})`);
  const sheet = chosen as { name: string; target: string };
  const path = sheet.target.startsWith("/")
    ? sheet.target.slice(1)
    : `xl/${sheet.target.replace(/^\.\//, "")}`;
  const body = xml(path) ?? fail(`sheet '${sheet.name}' is missing from the file`);
  const shared = [...(xml("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    texts(m[1] ?? ""),
  );

  const rows: string[][] = [];
  for (const r of body.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const c of (r[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? "";
      const inner = c[2] ?? "";
      const ref = attr(` ${attrs}`, "r");
      const at = ref ? colIndex(ref) : next;
      const type = attr(` ${attrs}`, "t") ?? "n";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const f = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inner)?.[1];
      let value: string;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = texts(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = decodeXml(v);
      else value = f !== undefined ? `=${decodeXml(f)}` : "";
      while (row.length < at) row.push("");
      row[at] = value;
      next = at + 1;
    }
    if (row.some((x) => x.trim() !== "")) rows.push(row);
  }
  return { sheet: sheet.name, rows };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** A minimal one-sheet workbook with text cells (templates for non-developers, 16 §4). */
export function writeXlsx(sheetName: string, rows: string[][]): Uint8Array {
  const sheetRows = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map(
            (v, c) =>
              `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(
      `${x}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${x}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `${x}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${x}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `${x}<worksheet xmlns="${main}"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  });
}
