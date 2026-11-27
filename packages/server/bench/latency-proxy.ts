import { createConnection, createServer, type Server, type Socket } from "node:net";

/**
 * A TCP proxy for profile 3 of the measurement (plan 6.1 §8): every chunk, in both directions, is forwarded
 * `delayMs` after it arrived. Order is kept, and delays do not add up: a chunk that arrives while another waits is
 * sent at its own arrival + delay, not after the other's. Only data is delayed; the TCP handshake to the proxy is
 * as fast as loopback (plan §8, QA re-check 4), and there is no TLS.
 */
export interface LatencyProxy {
  port: number;
  /** Connections accepted so far. */
  connections(): number;
  close(): Promise<void>;
}

/** Forwards `from` → `to` with a fixed delay per chunk, in arrival order. */
function delayed(from: Socket, to: Socket, delayMs: number, now: () => number): void {
  const queue: { at: number; chunk: Buffer }[] = [];
  let timer: NodeJS.Timeout | undefined;
  let ended = false;
  const flush = () => {
    timer = undefined;
    const t = now();
    while (queue.length && (queue[0] as { at: number }).at <= t) to.write((queue.shift() as { chunk: Buffer }).chunk);
    if (queue.length) timer = setTimeout(flush, Math.max(0, (queue[0] as { at: number }).at - now()));
    else if (ended) to.end();
  };
  from.on("data", (chunk: Buffer) => {
    queue.push({ at: now() + delayMs, chunk });
    if (!timer) timer = setTimeout(flush, delayMs);
  });
  from.on("end", () => {
    ended = true;
    if (!timer && queue.length === 0) to.end();
  });
}

export async function startLatencyProxy(o: {
  targetPort: number;
  targetHost?: string;
  delayMs: number;
  now?: () => number;
}): Promise<LatencyProxy> {
  const now = o.now ?? (() => performance.now());
  const sockets = new Set<Socket>();
  let accepted = 0;
  const server: Server = createServer((client) => {
    accepted++;
    const upstream = createConnection({ port: o.targetPort, host: o.targetHost ?? "127.0.0.1" });
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.setNoDelay(true);
      s.on("close", () => sockets.delete(s));
    }
    const kill = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", kill);
    upstream.on("error", kill);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    delayed(client, upstream, o.delayMs, now);
    delayed(upstream, client, o.delayMs, now);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    connections: () => accepted,
    close: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
