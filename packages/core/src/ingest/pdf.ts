import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

export interface PdfLimits {
  /** Wall-clock limit for the whole parse; the worker is terminated, not just ignored (QA plan). */
  timeoutMs?: number;
  /** V8 heap for the worker; past it the worker dies instead of this process. */
  maxMemoryMb?: number;
  maxPages?: number;
  /**
   * Growth of this process's resident memory while parsing. pdf.js decodes streams into buffers outside
   * the V8 heap, which \`maxMemoryMb\` does not cover, so a decompression bomb is stopped here (QA, #104).
   */
  maxRssGrowthMb?: number;
}

export interface PdfText {
  text: string;
  title?: string;
  pages: number;
  warnings: string[];
}

const MAX_TEXT_CHARS = 2 * 1024 * 1024;
const DEFAULTS = { timeoutMs: 20_000, maxMemoryMb: 256, maxPages: 500, maxRssGrowthMb: 256 };

/**
 * Runs in its own thread: pdf.js (through unpdf) with eval off, text only. Pages are read one by one
 * and reading stops as soon as the text limit is reached.
 */
const WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { getDocumentProxy } = require(workerData.lib);
  let pdf;
  try {
    pdf = await getDocumentProxy(workerData.data, {
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      stopAtErrors: false,
    });
  } catch (e) {
    const name = (e && e.name) || "";
    parentPort.postMessage({ error: name === "PasswordException" ? "password" : String((e && e.message) || e) });
    return;
  }
  if (pdf.numPages > workerData.maxPages) {
    parentPort.postMessage({ error: "pages", pages: pdf.numPages });
    return;
  }
  let title;
  try {
    const meta = await pdf.getMetadata();
    title = meta && meta.info && typeof meta.info.Title === "string" ? meta.info.Title : undefined;
  } catch {}
  const pages = [];
  let size = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      text += item.str;
      if (item.hasEOL) text += "\\n";
    }
    page.cleanup();
    size += text.length;
    if (size > workerData.maxText) {
      parentPort.postMessage({ error: "text" });
      return;
    }
    pages.push(text.replace(/[ \\t]+\\n/g, "\\n").trim());
  }
  parentPort.postMessage({ text: pages.filter(Boolean).join("\\n\\n"), title, pages: pdf.numPages });
})().catch((e) => parentPort.postMessage({ error: String((e && e.message) || e) }));
`;

/** Things in the raw file a person should know about; none of them is ever run or extracted. */
function rawWarnings(data: Uint8Array): string[] {
  const raw = new TextDecoder("latin1").decode(data);
  const out: string[] = [];
  if (/\/(JavaScript|JS)\b/.test(raw)) out.push("the pdf contains JavaScript; it was ignored, not run");
  if (/\/Launch\b/.test(raw)) out.push("the pdf contains a launch action; it was ignored");
  if (/\/EmbeddedFiles?\b/.test(raw)) out.push("the pdf contains embedded files; they were not extracted");
  return out;
}

/**
 * 16 §7: text of a PDF for whole-document import. Parsing runs in a worker thread with a heap limit
 * and a wall-clock limit that terminates it; password-protected files, more than \`maxPages\` pages
 * and more than 2 MB of text are refused. Scanned pages without a text layer give no text (no OCR).
 */
export async function readPdf(data: Uint8Array, limits: PdfLimits = {}): Promise<PdfText> {
  const { timeoutMs, maxMemoryMb, maxPages, maxRssGrowthMb } = { ...DEFAULTS, ...limits };
  const head = new TextDecoder("latin1").decode(data.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new Error("not a pdf file");
  const warnings = rawWarnings(data);
  const lib = createRequire(import.meta.url).resolve("unpdf");
  const worker = new Worker(WORKER, {
    eval: true,
    workerData: { lib, data: data.slice(), maxPages, maxText: MAX_TEXT_CHARS },
    resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    stdout: true,
    stderr: true,
  });
  type Msg = { error?: string; pages?: number; text?: string; title?: string };
  const baseRss = process.memoryUsage.rss();
  let watch: ReturnType<typeof setInterval> | undefined;
  const msg = await new Promise<Msg>((resolve, reject) => {
    watch = setInterval(() => {
      if (process.memoryUsage.rss() - baseRss > maxRssGrowthMb * 1024 * 1024) {
        clearInterval(watch);
        clearTimeout(timer);
        void worker.terminate();
        reject(
          new Error(
            `reading the pdf ran out of memory (limit ${maxRssGrowthMb} MB); the pdf was not imported`,
          ),
        );
      }
    }, 20);
    const timer = setTimeout(() => {
      clearInterval(watch);
      void worker.terminate();
      reject(new Error(`reading the pdf took longer than ${timeoutMs / 1000} s; the pdf was not imported`));
    }, timeoutMs);
    worker.once("message", (m: Msg) => {
      clearInterval(watch);
      clearTimeout(timer);
      void worker.terminate();
      resolve(m);
    });
    worker.once("error", (e: Error & { code?: string }) => {
      clearInterval(watch);
      clearTimeout(timer);
      void worker.terminate();
      reject(
        new Error(
          e.code === "ERR_WORKER_OUT_OF_MEMORY" || /out of memory|heap/i.test(e.message)
            ? `reading the pdf ran out of memory (limit ${maxMemoryMb} MB); the pdf was not imported`
            : `the pdf could not be read (${e.message})`,
        ),
      );
    });
    worker.once("exit", (code) => {
      clearInterval(watch);
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(`reading the pdf ran out of memory (limit ${maxMemoryMb} MB); the pdf was not imported`),
        );
    });
  });
  if (msg.error === "password")
    throw new Error("the pdf is encrypted with a password; remove the password first");
  if (msg.error === "pages")
    throw new Error(
      `the pdf has ${msg.pages} pages; at most ${maxPages} are imported, split it into smaller files`,
    );
  if (msg.error === "text") throw new Error("the pdf text is larger than 2 MB; split it into smaller files");
  if (msg.error) throw new Error(`the pdf could not be read (${msg.error})`);
  if ((msg.pages ?? 0) < 1) throw new Error("the pdf has no pages");
  return {
    text: msg.text ?? "",
    ...(msg.title?.trim() ? { title: msg.title.trim() } : {}),
    pages: msg.pages ?? 0,
    warnings,
  };
}
