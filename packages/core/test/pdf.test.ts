import { describe, expect, it } from "vitest";
import { readPdf } from "../src/index.js";
import { makePdf } from "./support/pdf.js";

describe("pdf reader (M4b.3b)", () => {
  it("extracts text page by page, with the Info title", async () => {
    const r = await readPdf(
      makePdf({
        title: "Ops handbook",
        pages: [["Ops handbook", "Rotate keys every 90 days."], ["Second page text."]],
      }),
    );
    expect(r.title).toBe("Ops handbook");
    expect(r.pages).toBe(2);
    expect(r.text).toBe("Ops handbook\nRotate keys every 90 days.\n\nSecond page text.");
    expect(r.warnings).toEqual([]);
  });

  it("refuses a password-protected pdf", async () => {
    await expect(readPdf(makePdf({ pages: [["secret"]], encrypt: true }))).rejects.toThrow(
      /encrypted with a password/,
    );
  });

  it("refuses more pages than the limit without reading them", async () => {
    const many = makePdf({ pages: Array.from({ length: 600 }, (_, i) => [`page ${i}`]) });
    await expect(readPdf(many)).rejects.toThrow(/has 600 pages; at most 500 are imported, split it/);
  }, 30_000);

  it("warns about JavaScript, launch actions and embedded files, and never runs them", async () => {
    const r = await readPdf(
      makePdf({
        pages: [["Hello"]],
        extraCatalog:
          "/OpenAction << /S /JavaScript /JS (app.alert(1)) >> /Names << /EmbeddedFiles << /Names [] >> >>",
        extraObjects: ["<< /S /Launch /F (calc.exe) >>"],
      }),
    );
    expect(r.text).toBe("Hello");
    expect(r.warnings).toEqual([
      "the pdf contains JavaScript; it was ignored, not run",
      "the pdf contains a launch action; it was ignored",
      "the pdf contains embedded files; they were not extracted",
    ]);
  });

  it("stops a page tree that points to itself", async () => {
    await expect(readPdf(makePdf({ pages: [["x"]], kidsLoop: true }), { timeoutMs: 5000 })).rejects.toThrow(
      /could not be read|took longer than|has no pages/,
    );
  }, 20_000);

  it("stops parsing at the time limit (the worker is terminated)", async () => {
    const big = makePdf({
      pages: Array.from({ length: 400 }, (_, i) =>
        Array.from({ length: 40 }, (_, j) => `line ${i} ${j} lorem ipsum dolor`),
      ),
    });
    const t0 = performance.now();
    await expect(readPdf(big, { timeoutMs: 50 })).rejects.toThrow(
      /took longer than 0\.05 s; the pdf was not imported/,
    );
    expect(performance.now() - t0).toBeLessThan(3000);
  }, 20_000);

  it("stops a decompression bomb at the memory limit (buffers outside the V8 heap count too)", async () => {
    const bomb = makePdf({ pages: [["x"]], bombStreamBytes: 600 * 1024 * 1024 });
    expect(bomb.length).toBeLessThan(1_000_000);
    await expect(readPdf(bomb, { maxRssGrowthMb: 128 })).rejects.toThrow(
      /ran out of memory \(limit 128 MB\)/,
    );
  }, 60_000);

  it("refuses something that is not a pdf, and a broken xref still reads or fails cleanly", async () => {
    await expect(readPdf(new TextEncoder().encode("hello"))).rejects.toThrow(/not a pdf file/);
    const ok = makePdf({ pages: [["Recovered text"]] });
    const broken = new TextDecoder("latin1").decode(ok).replace(/startxref\n\d+/, "startxref\n999999");
    const r = await readPdf(Uint8Array.from(broken, (c) => c.charCodeAt(0)));
    expect(r.text).toBe("Recovered text");
  }, 20_000);
});
