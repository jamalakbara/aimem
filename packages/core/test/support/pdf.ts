import { deflateSync } from "node:zlib";

/** Hand-built PDFs for tests: valid xref offsets, text in Helvetica, optional extras. */
export function makePdf(opts: {
  pages: string[][];
  title?: string;
  extraCatalog?: string;
  extraObjects?: string[];
  encrypt?: boolean;
  kidsLoop?: boolean;
  bombStreamBytes?: number;
}): Uint8Array {
  const enc = new TextEncoder();
  const objs: (string | Uint8Array)[] = [];
  const add = (o: string | Uint8Array) => {
    objs.push(o);
    return objs.length;
  };
  const catalog = add("");
  const pagesId = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const lines of opts.pages) {
    const ops = lines
      .map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  if (opts.bombStreamBytes) {
    // A Flate stream that inflates to many zeros: the page content of page 1.
    const z = deflateSync(Buffer.alloc(opts.bombStreamBytes, 0x20), { level: 9 });
    const head = enc.encode(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`);
    const tail = enc.encode("\nendstream");
    const bomb = new Uint8Array(head.length + z.length + tail.length);
    bomb.set(head, 0);
    bomb.set(z, head.length);
    bomb.set(tail, head.length + z.length);
    const id = add(bomb);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${id} 0 R >>`));
  }
  const kidList = opts.kidsLoop ? `${pagesId} 0 R` : kids.map((k) => `${k} 0 R`).join(" ");
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kidList}] /Count ${opts.kidsLoop ? 1 : kids.length} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R ${opts.extraCatalog ?? ""} >>`;
  for (const o of opts.extraObjects ?? []) add(o);
  const info = opts.title ? add(`<< /Title (${opts.title}) >>`) : 0;
  const encId = opts.encrypt
    ? add(`<< /Filter /Standard /V 1 /R 2 /O <${"11".repeat(32)}> /U <${"22".repeat(32)}> /P -4 >>`)
    : 0;
  const parts: Uint8Array[] = [enc.encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")];
  let pos = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    const head = enc.encode(`${i + 1} 0 obj\n`);
    const body = typeof o === "string" ? enc.encode(o) : o;
    const tail = enc.encode("\nendobj\n");
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xref = [
    "xref",
    `0 ${objs.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""}${encId ? ` /Encrypt ${encId} 0 R /ID [<${"33".repeat(16)}> <${"33".repeat(16)}>]` : ""} >>`,
    "startxref",
    String(pos),
    "%%EOF",
  ].join("\n");
  parts.push(enc.encode(xref));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
