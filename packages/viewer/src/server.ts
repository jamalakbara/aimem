import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AimemError, type Clock, type Fs } from "@aimem/core";
import { SCRIPT } from "./assets/app.js";
import { STYLE } from "./assets/style.js";
import { IndexCache, openNotebook, type Snapshot } from "./cache.js";
import { checkRequest, type Target } from "./guard.js";
import type { Html } from "./html.js";
import { dashboard } from "./pages/dashboard.js";
import { errorPage } from "./pages/error.js";
import { layout } from "./pages/layout.js";
import { findRoot, safeFs } from "./safe-fs.js";
import { T } from "./strings.js";

export interface ViewerOptions {
  fs: Fs;
  clock: Clock;
  /** Where cached sibling checkouts live (03 §7). */
  cacheHome: string;
  /** The notebook is looked up from here. */
  dir: string;
  /** 0 picks a free port. */
  port: number;
  /** Header and request timeout (default 10 s) and load limit; tests shorten them. */
  timeoutMs?: number;
  loadMs?: number;
}

export interface Viewer {
  url: string;
  address: string;
  port: number;
  project: string;
  maxConnections: number;
  /** Called before a page is rendered; tests use it to make a page fail. */
  onRender(hook: () => void): void;
  close(): Promise<void>;
}

const HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cache-Control": "no-store",
};
const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

interface Answer {
  status: number;
  type: string;
  body: string;
  headers?: Record<string, string>;
}
const page = (status: number, title: string, body: Html): Answer => ({
  status,
  type: HTML,
  body: layout(title, body),
});
const failure = (status: number, message: string) =>
  page(status, T.errors[status] ?? "aimem", errorPage(status, message));

/** Starts the local, read-only viewer (24 §5.1). Listens on 127.0.0.1 only; there is no option for more. */
export async function startViewer(o: ViewerOptions): Promise<Viewer> {
  const root = await findRoot(o.fs, o.dir);
  if (!root) throw new AimemError("NOT_INITIALIZED", "No .aimem/ found. Run `aimem init` in your repo.");
  const nb = await openNotebook(safeFs(o.fs).fs, root);
  const project = nb.config.project;
  const cache = new IndexCache({
    fs: o.fs,
    clock: o.clock,
    cacheHome: o.cacheHome,
    root,
    ...(o.loadMs !== undefined ? { loadMs: o.loadMs } : {}),
  });
  let port = o.port;
  let hook: () => void = () => undefined;

  async function answer({ segments }: Target): Promise<Answer> {
    const [a, b, ...rest] = segments;
    if (a === undefined)
      return {
        status: 302,
        type: TEXT,
        body: "",
        headers: { Location: `/p/${encodeURIComponent(project)}` },
      };
    if (a === "assets" && rest.length === 0) {
      if (b === "style.css") return { status: 200, type: "text/css; charset=utf-8", body: STYLE };
      if (b === "app.js") return { status: 200, type: "text/javascript; charset=utf-8", body: SCRIPT };
    }
    if (a !== "p" || b !== project) return failure(404, T.missing);
    if (rest.length) return failure(404, T.missing);
    let snapshot: Snapshot;
    try {
      snapshot = await cache.get();
    } catch {
      return failure(503, T.tryAgain);
    }
    hook();
    return page(200, snapshot.nb.config.name ?? project, dashboard(snapshot, o.clock.now()));
  }

  function send(req: IncomingMessage, res: ServerResponse, a: Answer): void {
    const hasBody =
      req.headers["content-length"] !== undefined || req.headers["transfer-encoding"] !== undefined;
    const bytes = Buffer.from(a.body, "utf8");
    res.writeHead(a.status, {
      ...HEADERS,
      "Content-Type": a.type,
      "Content-Length": bytes.length,
      ...a.headers,
      // A request body is never read, so the rest of that connection cannot be trusted to be a request.
      ...(hasBody ? { Connection: "close" } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
    if (hasBody) res.on("finish", () => req.socket.destroySoon());
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const verdict = checkRequest(req, port);
    if (!verdict.ok)
      return send(req, res, {
        status: verdict.status,
        type: TEXT,
        body: `${verdict.message}\n`,
        ...(verdict.status === 405 ? { headers: { Allow: "GET, HEAD" } } : {}),
      });
    let a: Answer;
    try {
      a = await answer(verdict.target);
    } catch {
      a = failure(500, T.failed);
    }
    send(req, res, a);
  }

  const timeout = o.timeoutMs ?? 10_000;
  const server = createServer({
    // The guard answers these, so that every answer has the same headers.
    requireHostHeader: false,
    headersTimeout: timeout,
    requestTimeout: timeout,
    connectionsCheckingInterval: Math.min(1000, timeout),
    keepAliveTimeout: 5000,
  });
  server.maxConnections = 64;
  const on = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(() => res.destroy());
  };
  server.on("request", on);
  // Without this, node would answer `100 Continue` and invite the body.
  server.on("checkContinue", on);
  server.on("checkExpectation", on);
  server.on("connect", (_req, socket) => socket.destroy());
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("clientError", (_e, socket) => {
    if (!socket.writable) return void socket.destroy();
    const lines = Object.entries(HEADERS).map(([k, v]) => `${k}: ${v}\r\n`);
    socket.end(`HTTP/1.1 400 Bad Request\r\n${lines.join("")}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  });
  await new Promise<void>((done, fail) => {
    server.once("error", (e: Error & { code?: string }) =>
      fail(
        e.code === "EADDRINUSE"
          ? new AimemError("USAGE", `port ${o.port} is already in use; choose another with --port`)
          : e.code === "EACCES"
            ? new AimemError("USAGE", `port ${o.port} is not allowed here; choose another with --port`)
            : e,
      ),
    );
    server.listen({ host: "127.0.0.1", port: o.port, exclusive: true }, done);
  });
  const at = server.address();
  if (at === null || typeof at === "string") throw new Error("no address");
  port = at.port;
  // Warm up in the background; a failure shows on the page.
  cache.get().catch(() => undefined);
  return {
    url: `http://127.0.0.1:${port}/`,
    address: at.address,
    port,
    project,
    maxConnections: server.maxConnections,
    onRender: (h) => {
      hook = h;
    },
    close: () =>
      new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
