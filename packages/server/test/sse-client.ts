import { type ClientRequest, type IncomingMessage, request } from "node:http";

export interface SseEvent {
  id: string;
  event: string;
  // biome-ignore lint/suspicious/noExplicitAny: tests read JSON of any shape
  data: any;
}

/** A test SSE client on raw HTTP: every event, every ping, the raw bytes, and when the server closed the stream. */
export interface SseStream {
  status: number;
  headers: IncomingMessage["headers"];
  /** The problem+json body when the status is not 200. */
  // biome-ignore lint/suspicious/noExplicitAny: tests read JSON of any shape
  problem: any;
  events: SseEvent[];
  pings: number;
  raw(): string;
  /** Resolves when the server ends the stream (or the connection breaks). */
  ended: Promise<void>;
  isEnded(): boolean;
  /** Waits until `pred` holds for the events received so far. */
  waitFor(pred: (events: SseEvent[]) => boolean, timeoutMs?: number, what?: string): Promise<SseEvent[]>;
  /** Waits until `n` events have arrived. */
  waitForCount(n: number, timeoutMs?: number): Promise<SseEvent[]>;
  /** Stops reading from the socket (a slow reader) or starts again. */
  pause(): void;
  resume(): void;
  close(): void;
  /** The `id:` of the last event, for `Last-Event-ID`. */
  lastId(): string | undefined;
}

export function openStream(
  base: string,
  path: string,
  o: { token?: string; lastEventId?: string; headers?: Record<string, string> } = {},
): Promise<SseStream> {
  return new Promise((done, fail) => {
    const url = new URL(path, base);
    const req: ClientRequest = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        agent: false,
        headers: {
          Accept: "text/event-stream",
          ...(o.token !== undefined ? { Authorization: `Bearer ${o.token}` } : {}),
          ...(o.lastEventId !== undefined ? { "Last-Event-ID": o.lastEventId } : {}),
          ...o.headers,
        },
      },
      (res) => {
        let rawText = "";
        let buffer = "";
        let ended = false;
        let endedResolve!: () => void;
        const ended$ = new Promise<void>((d) => {
          endedResolve = d;
        });
        const waiters = new Set<() => void>();
        const notify = () => {
          for (const w of [...waiters]) w();
        };
        const s: SseStream = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          problem: undefined,
          events: [],
          pings: 0,
          raw: () => rawText,
          ended: ended$,
          isEnded: () => ended,
          waitFor: (pred, timeoutMs = 5_000, what = "events") =>
            new Promise((ok, no) => {
              if (pred(s.events)) return ok(s.events);
              const timer = setTimeout(() => {
                waiters.delete(check);
                no(
                  new Error(
                    `timed out after ${timeoutMs} ms waiting for ${what}; got ${s.events.length} events`,
                  ),
                );
              }, timeoutMs);
              const check = () => {
                if (pred(s.events)) {
                  clearTimeout(timer);
                  waiters.delete(check);
                  ok(s.events);
                } else if (ended) {
                  clearTimeout(timer);
                  waiters.delete(check);
                  no(new Error(`stream ended while waiting for ${what}; got ${s.events.length} events`));
                }
              };
              waiters.add(check);
            }),
          waitForCount: (n, timeoutMs) => s.waitFor((e) => e.length >= n, timeoutMs, `${n} events`),
          pause: () => res.pause(),
          resume: () => res.resume(),
          close: () => {
            req.destroy();
          },
          lastId: () => s.events.at(-1)?.id,
        };
        const finish = () => {
          if (ended) return;
          ended = true;
          endedResolve();
          notify();
        };
        res.setEncoding("utf8");
        if (s.status !== 200) {
          res.on("data", (d: string) => {
            rawText += d;
          });
          res.on("end", () => {
            try {
              s.problem = JSON.parse(rawText);
            } catch {
              s.problem = undefined;
            }
            finish();
            done(s);
          });
          res.on("error", finish);
          return;
        }
        res.on("data", (d: string) => {
          rawText += d;
          buffer += d;
          let at = buffer.indexOf("\n\n");
          while (at >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            at = buffer.indexOf("\n\n");
            const e: Partial<SseEvent> & { data?: string } = {};
            let comment = false;
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) {
                comment = true;
                continue;
              }
              const i = line.indexOf(":");
              const k = i < 0 ? line : line.slice(0, i);
              const v = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
              if (k === "id") e.id = v;
              else if (k === "event") e.event = v;
              else if (k === "data") e.data = e.data === undefined ? v : `${e.data}\n${v}`;
            }
            if (e.data !== undefined)
              s.events.push({ id: e.id ?? "", event: e.event ?? "message", data: JSON.parse(e.data) });
            else if (comment) s.pings++;
          }
          notify();
        });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
        done(s);
      },
    );
    req.on("error", fail);
    req.end();
  });
}
