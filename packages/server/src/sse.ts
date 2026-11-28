import type { IncomingMessage, ServerResponse } from "node:http";
import { type Caller, rawHeader } from "./auth.js";
import type { Hooks } from "./hooks.js";
import { HttpError, usage } from "./problem.js";

/** Streams per instance (plan A12); one more gets 503. */
export const MAX_STREAMS = 256;
/** Comment line and access re-check interval (plan A12, QA W4). */
export const PING_MS = 15_000;
/** Unsent bytes allowed per subscriber before its stream is closed (plan §5). */
export const STREAM_BUFFER_BYTES = 1024 * 1024;
/** How long a full buffer may take to drain before the reader counts as stalled. */
export const DRAIN_WAIT_MS = 10_000;
/** Events read from the table per query. */
export const BATCH = 200;
/** After a failed read the subscriber tries again after this wait. */
const RETRY_MS = 1_000;

/** What the streams need from the database: the pool, or a fake in unit tests. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** What the streams need from the hub: register before reading the backlog. */
export interface Subscribe {
  subscribe(projectId: string, wake: () => void): () => void;
}

export interface StreamOptions {
  maxStreams?: number;
  pingMs?: number;
  bufferBytes?: number;
  drainWaitMs?: number;
  hooks?: Hooks;
  /** Extra response headers (the server's `Aimem-Instance`). */
  headers?: Record<string, string>;
}

const CURSOR = /^(0|[1-9][0-9]{0,18})$/;

/**
 * The start cursor (plan §5 step 1): `Last-Event-ID` over `?since`; neither gives `undefined` (only new events).
 * Both are checked when both are sent. Compared as BigInt (QA W6.5).
 */
export function readCursor(req: IncomingMessage, url: URL): bigint | undefined {
  for (const key of url.searchParams.keys())
    if (key !== "since") throw usage(`Unknown query parameter "${key}".`);
  const since = url.searchParams.getAll("since");
  const header = rawHeader(req, "last-event-id");
  if (since.length > 1 || header.length > 1) throw usage("Send one cursor.");
  const parse = (raw: string) => {
    if (!CURSOR.test(raw)) throw usage("The cursor must be a whole number of 0 or more.");
    return BigInt(raw);
  };
  const fromQuery = since[0] !== undefined ? parse(since[0]) : undefined;
  const fromHeader = header[0] !== undefined ? parse(header[0]) : undefined;
  return fromHeader ?? fromQuery;
}

/** One SSE message (plan §6.3); the JSON is on one line, so `data:` needs no splitting. */
export function formatEvent(seq: string, type: string, payload: unknown): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** The stream may go on: token still valid, membership still there, `read` still in scope (QA W4, IZ-6). */
async function allowed(db: Queryable, caller: Caller): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM tokens t
       JOIN memberships m ON m.project_id = t.project_id AND m.user_id = t.user_id
      WHERE t.id = $1 AND t.project_id = $2 AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > clock_timestamp()) AND 'read' = ANY(t.scopes)`,
    [caller.tokenId, caller.projectId],
  );
  return r.rows.length === 1;
}

/** The connection already ended (closed, destroyed, or its socket is gone). */
// `req.destroyed` is not used: a request is destroyed once its body has been read, also on a live connection.
function gone(res: ServerResponse): boolean {
  return res.destroyed || res.closed || !res.socket || res.socket.destroyed;
}

/** Every open SSE stream of one server instance. */
export class Streams {
  private open = 0;
  private readonly max: number;
  private readonly pingMs: number;
  private readonly bufferBytes: number;
  private readonly drainWaitMs: number;
  private readonly closers = new Set<() => void>();

  constructor(
    private readonly db: Queryable,
    private readonly hub: Subscribe,
    private readonly o: StreamOptions = {},
  ) {
    this.max = o.maxStreams ?? MAX_STREAMS;
    this.pingMs = o.pingMs ?? PING_MS;
    this.bufferBytes = o.bufferBytes ?? STREAM_BUFFER_BYTES;
    this.drainWaitMs = o.drainWaitMs ?? DRAIN_WAIT_MS;
  }

  /** Open streams now; back to 0 once every client is gone (EV-9, cleanup). */
  get count(): number {
    return this.open;
  }

  /** Ends every stream (server shutdown). */
  closeAll(): void {
    for (const c of [...this.closers]) c();
  }

  /**
   * Starts a stream. Errors before the 200 (full, cursor ahead) are thrown as HttpError, so the caller answers
   * them as problem+json; after the 200 nothing is thrown.
   */
  async start(req: IncomingMessage, res: ServerResponse, caller: Caller, cursor: bigint | undefined) {
    if (this.open >= this.max)
      throw new HttpError(503, "SYNC_FAILED", "Too many open event streams; try again later.", undefined, {
        "Retry-After": "5",
      });
    this.open++;
    let closed = false;
    let started = false;
    let last = 0n;
    let pumping = false;
    let again = false;
    let first = true;
    let ping: NodeJS.Timeout | undefined;
    let retry: NodeJS.Timeout | undefined;

    const close = () => {
      if (closed) return;
      closed = true;
      this.open--;
      this.closers.delete(close);
      unsubscribe();
      clearInterval(ping);
      clearTimeout(retry);
      if (!started || res.destroyed) return;
      res.end();
      // A reader that never takes the rest would keep the connection open: cut it after the same wait (QA N1).
      // Unsent bytes may sit in the response or, once it has finished (Windows), still in the socket.
      const socket = res.socket;
      const pending = () =>
        !res.writableFinished || (socket !== null && !socket.destroyed && socket.writableLength > 0);
      if (pending()) {
        const cut = setTimeout(() => {
          if (pending()) res.destroy();
        }, this.drainWaitMs);
        cut.unref();
      }
    };
    const pump = () => {
      if (closed || !started) return;
      if (pumping) {
        again = true;
        return;
      }
      pumping = true;
      void (async () => {
        try {
          do {
            again = false;
            await drain();
          } while (again && !closed);
        } catch {
          // Database trouble: try again later; the stream stays open (plan §5).
          if (!closed) {
            clearTimeout(retry);
            retry = setTimeout(pump, RETRY_MS);
            retry.unref();
          }
        } finally {
          pumping = false;
        }
      })();
    };
    const drained = () =>
      new Promise<boolean>((done) => {
        const timer = setTimeout(() => finish(false), this.drainWaitMs);
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          res.off("drain", onDrain);
          res.off("close", onClose);
          done(ok);
        };
        const onDrain = () => finish(true);
        const onClose = () => finish(false);
        res.on("drain", onDrain);
        res.on("close", onClose);
      });
    /**
     * Reads `seq > last` in order and sends it. Access is checked once per read, after the read and before the
     * first write, and again after every wait for a slow reader (plan §5, QA Q4).
     */
    const drain = async () => {
      for (;;) {
        if (closed) return;
        const r = await this.db.query(
          // Ordered by the bigint column of the table: ORDER BY "seq" would pick the text output column (1, 10, 100…).
          "SELECT e.seq::text AS seq, e.type, e.payload FROM events e WHERE e.project_id = $1 AND e.seq > $2::bigint ORDER BY e.seq LIMIT $3",
          [caller.projectId, last.toString(), BATCH],
        );
        if (first) {
          first = false;
          await this.o.hooks?.stream?.("backlog", { projectId: caller.projectId });
        }
        if (r.rows.length === 0 || closed) return;
        // A revocation that committed before these events did is seen here, so they are not sent (IZ-6).
        if (!(await allowed(this.db, caller))) return close();
        for (const row of r.rows) {
          const seq = BigInt(String(row.seq));
          if (seq <= last) continue; // dedup (plan §5 step 2)
          if (closed) return;
          // More than the limit is still unsent: wait for the reader; one that does not read is dropped and
          // reconnects with Last-Event-ID (plan §5).
          if (res.writableLength >= this.bufferBytes) {
            if (!(await drained())) {
              res.destroy();
              return close();
            }
            if (closed) return;
            // Access may have gone while we waited: check again before writing more (QA Q4, plan §5).
            if (!(await allowed(this.db, caller))) return close();
          }
          if (closed) return;
          res.write(formatEvent(seq.toString(), String(row.type), row.payload));
          last = seq;
        }
        if (r.rows.length < BATCH) return;
      }
    };

    this.closers.add(close);
    // Listen first, then read (plan §5 step 2): nothing that commits in between is missed.
    const unsubscribe = this.hub.subscribe(caller.projectId, pump);
    req.on("close", close);
    res.on("close", close);
    // The client may have gone while the token was checked, before these listeners existed: its "close" has
    // already fired, so release the slot now (QA Q1).
    if (gone(res)) {
      close();
      return;
    }
    try {
      await this.o.hooks?.stream?.("registered", { projectId: caller.projectId });
      const r = await this.db.query(
        "SELECT last_seq::text AS last_seq FROM project_event_seq WHERE project_id = $1",
        [caller.projectId],
      );
      const top = BigInt(String(r.rows[0]?.last_seq ?? "0"));
      if (cursor !== undefined && cursor > top) throw usage("The cursor is ahead of the latest event.");
      last = cursor ?? top;
    } catch (e) {
      close();
      throw e;
    }
    if (closed) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      Connection: "keep-alive",
      ...this.o.headers,
    });
    res.flushHeaders();
    started = true;
    ping = setInterval(() => {
      void (async () => {
        try {
          if (!(await allowed(this.db, caller))) return close();
        } catch {
          // Unknown while the database is away; the next ping checks again.
        }
        if (closed) return;
        res.write(": ping\n\n");
        pump();
      })();
    }, this.pingMs);
    ping.unref();
    pump();
  }
}
