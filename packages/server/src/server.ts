import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Scope } from "./admin.js";
import { authenticate, type Caller } from "./auth.js";
import { Claims, type Outcome } from "./claims.js";
import { CommitUncertain, createPool, type Pool, unavailable } from "./db.js";
import { EventHub, type HubOptions } from "./events.js";
import type { Hooks } from "./hooks.js";
import { HttpError, notFound, problemBody, unauthenticated } from "./problem.js";
import { readCursor, type StreamOptions, Streams } from "./sse.js";
import { readAcquire, readEmptyBody, readSession, readTaskId } from "./validate.js";

export const MAX_BODY_BYTES = 16 * 1024;
/** How often each instance runs the sweeper (claim.expired is a notice, not a deadline). */
export const SWEEP_MS = 15_000;

/** The project routes. The permission tests are generated from this list, so a new route needs a row there. */
export const ROUTES = [
  { name: "live", method: "GET", scope: "read", path: (slug: string) => `/v1/projects/${slug}/live` },
  { name: "events", method: "GET", scope: "read", path: (slug: string) => `/v1/projects/${slug}/events` },
  {
    name: "acquire",
    method: "POST",
    scope: "write:live",
    path: (slug: string) => `/v1/projects/${slug}/claims`,
  },
  {
    name: "heartbeat",
    method: "PUT",
    scope: "write:live",
    path: (slug: string, task = "tsk-00000000") => `/v1/projects/${slug}/claims/${task}/heartbeat`,
  },
  {
    name: "release",
    method: "DELETE",
    scope: "write:live",
    path: (slug: string, task = "tsk-00000000") => `/v1/projects/${slug}/claims/${task}`,
  },
] as const satisfies readonly {
  name: string;
  method: string;
  scope: Scope;
  path: (...a: string[]) => string;
}[];

export interface ServerOptions {
  databaseUrl?: string;
  /** An existing pool (tests); the server does not close it. */
  pool?: Pool;
  poolMax?: number;
  /** Always loopback in 6.1 (plan A12). */
  host?: "127.0.0.1";
  port?: number;
  hooks?: Hooks;
  /** One line per failure: status, code and error class. Never request data. */
  log?: (line: string) => void;
  /** SSE limits (tests shorten the ping); defaults from plan A12. */
  streams?: Omit<StreamOptions, "hooks" | "headers">;
  /** LISTEN reconnect and fallback polling; defaults from plan §5. */
  listen?: HubOptions;
  /**
   * Name sent as `Aimem-Instance` on every response, so a measurement can prove which instance answered (plan §8).
   * Letters, digits and `-`, at most 32; anything else is ignored.
   */
  instance?: string;
  /** Sweeper interval in ms (default 15 s); `false` runs it only through `sweep()` (tests). */
  sweepMs?: number | false;
}

export interface RunningServer {
  url: string;
  port: number;
  pool: Pool;
  /** Open SSE streams of this instance. */
  streams(): number;
  /** True while this instance's LISTEN connection is up. */
  listening(): boolean;
  /** One sweeper run now; resolves to the number of `claim.expired` events written. */
  sweep(): Promise<number>;
  close(): Promise<void>;
}

const MATCH = /^\/v1\/projects\/([^/]+)\/(?:(live)|(events)|claims(?:\/([^/]+)(\/heartbeat)?)?)$/;

interface Route {
  slug: string;
  name: (typeof ROUTES)[number]["name"];
  task?: string;
}

function route(method: string, path: string): Route | undefined {
  const m = MATCH.exec(path);
  if (!m) return undefined;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1] ?? "");
  } catch {
    return undefined;
  }
  const [, , live, events, task, heartbeat] = m;
  if (live) return method === "GET" ? { slug, name: "live" } : undefined;
  if (events) return method === "GET" ? { slug, name: "events" } : undefined;
  if (task === undefined) return method === "POST" ? { slug, name: "acquire" } : undefined;
  if (heartbeat) return method === "PUT" ? { slug, name: "heartbeat", task } : undefined;
  return method === "DELETE" ? { slug, name: "release", task } : undefined;
}

/** The body, read up to the limit; past it, the rest is drained and `tooLarge` is set. */
function readBody(req: IncomingMessage): Promise<{ text: string; tooLarge: boolean }> {
  return new Promise((done, fail) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    let tooLarge = declared > MAX_BODY_BYTES;
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => done({ text: tooLarge ? "" : Buffer.concat(chunks).toString("utf8"), tooLarge }));
    req.on("error", fail);
  });
}

/** How a failure that is not a request error is answered; only a lost COMMIT confirmation has an unknown outcome. */
function failure(e: unknown): HttpError {
  if (e instanceof CommitUncertain)
    return new HttpError(
      503,
      "SYNC_FAILED",
      "The database did not confirm the change, so it may or may not have been saved. Repeat the same request with the same Aimem-Session header: the answer then shows what is stored.",
      { outcome: "unknown" },
      { "Retry-After": "1" },
    );
  if (unavailable(e))
    return new HttpError(503, "SYNC_FAILED", "The database is not available; nothing was saved.", undefined, {
      "Retry-After": "1",
    });
  return new HttpError(500, "SYNC_FAILED", "The server could not complete the request; nothing was saved.");
}

export async function startServer(o: ServerOptions): Promise<RunningServer> {
  const pool = o.pool ?? createPool(o.databaseUrl ?? "", o.poolMax ?? 10);
  // A failing idle client must not crash the process; the next query reconnects.
  pool.on("error", () => undefined);
  const claims = new Claims(pool, o.hooks);
  const log = o.log ?? (() => undefined);
  const hub = new EventHub(pool, o.listen);
  await hub.start();
  const instanceHeader: Record<string, string> =
    o.instance && /^[A-Za-z0-9-]{1,32}$/.test(o.instance) ? { "Aimem-Instance": o.instance } : {};
  const streams = new Streams(pool, hub, {
    ...o.streams,
    ...(o.hooks ? { hooks: o.hooks } : {}),
    headers: instanceHeader,
  });
  // The sweeper: one run at a time per instance; other instances may sweep too, the task lock keeps it once.
  let sweeping: Promise<number> | undefined;
  const sweep = () => {
    sweeping ??= claims.sweep().finally(() => {
      sweeping = undefined;
    });
    return sweeping;
  };
  const sweepMs = o.sweepMs ?? SWEEP_MS;
  const sweeper =
    sweepMs === false
      ? undefined
      : setInterval(() => {
          sweep().catch((e) =>
            log(`sweep error ${(e as { code?: string })?.code ?? (e as Error)?.name ?? "unknown"}`),
          );
        }, sweepMs);
  sweeper?.unref();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    const send = (status: number, payload: string, type: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...instanceHeader,
        ...(body.tooLarge ? { Connection: "close" } : {}),
        ...headers,
      });
      res.end(payload);
    };
    try {
      if (url.pathname === "/healthz" && req.method === "GET") {
        const ok = await pool.query("SELECT 1").then(
          () => true,
          () => false,
        );
        return send(ok ? 200 : 503, JSON.stringify({ ok }), "application/json");
      }
      const r = route(req.method ?? "", url.pathname);
      if (!r) throw notFound();
      // Tokens belong in the Authorization header only; one in the address is refused, not used.
      if (/aimem_/i.test(url.search)) throw unauthenticated();
      const spec = ROUTES.find((x) => x.name === r.name);
      if (!spec) throw notFound();
      const caller: Caller = await authenticate(pool, req, r.slug, spec.scope);
      if (body.tooLarge)
        throw new HttpError(413, "USAGE", `The body is larger than ${MAX_BODY_BYTES} bytes.`);
      let out: Outcome;
      if (r.name === "events") {
        readEmptyBody(body.text);
        // Errors before the 200 are thrown and answered below; afterwards the stream owns the response.
        return await streams.start(req, res, caller, readCursor(req, url));
      }
      if (r.name === "live") {
        readEmptyBody(body.text);
        out = await claims.live(caller);
      } else if (r.name === "acquire") {
        const session = readSession(req);
        const input = readAcquire(body.text, caller.slug, session);
        out = await claims.acquire(caller, session, input);
        const dropped = await afterCommit("acquire", input.task);
        if (dropped) return;
      } else {
        const session = readSession(req);
        const task = `${caller.slug}:${readTaskId(r.task ?? "")}`;
        readEmptyBody(body.text);
        out =
          r.name === "heartbeat"
            ? await claims.heartbeat(caller, session, task)
            : await claims.release(caller, session, task);
        if (await afterCommit(r.name, task)) return;
      }
      send(out.status, JSON.stringify(out.body), "application/json");
    } catch (e) {
      const err = e instanceof HttpError ? e : failure(e);
      if (!(e instanceof HttpError))
        log(`error ${err.status} ${(e as { code?: string })?.code ?? (e as Error)?.name ?? "unknown"}`);
      send(err.status, problemBody(err), "application/problem+json", err.headers);
    }

    async function afterCommit(op: "acquire" | "heartbeat" | "release", task: string): Promise<boolean> {
      let dropped = false;
      await o.hooks?.afterCommit?.({
        op,
        task,
        drop: () => {
          dropped = true;
        },
      });
      if (dropped) res.destroy();
      return dropped;
    }
  }

  const server = createServer({ headersTimeout: 10_000, requestTimeout: 10_000 }, (req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen({ host: o.host ?? "127.0.0.1", port: o.port ?? 0 }, () => done());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    pool,
    streams: () => streams.count,
    listening: () => hub.listening,
    sweep,
    close: async () => {
      clearInterval(sweeper);
      await sweeping?.catch(() => undefined);
      streams.closeAll();
      await hub.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      if (!o.pool) await pool.end();
    },
  };
}
