import { createConnection, createServer, type Server, type Socket } from "node:net";

/**
 * A TCP proxy for profile 3 of the measurement (plan 6.1 §8): every chunk, in both directions, is forwarded
 * `delayMs` after it arrived. Order is kept, and delays do not add up: a chunk that arrives while another waits is
 * sent at its own arrival + delay, not after the other's. A normal close is queued behind the data before it.
 * Only data is delayed; the TCP handshake to the proxy is
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
    if (to.destroyed) return;
    const t = now();
    while (queue.length && (queue[0] as { at: number }).at <= t) to.write((queue.shift() as { chunk: Buffer }).chunk);
    if (queue.length) timer = setTimeout(flush, Math.max(0, (queue[0] as { at: number }).at - now()));
    else if (ended) to.end();
  };
  from.on("data", (chunk: Buffer) => {
    queue.push({ at: now() + delayMs, chunk });
    if (!timer) timer = setTimeout(flush, delayMs);
  });
  // A normal close (FIN) is forwarded like data: after everything queued before it (QA 6.1b P1).
  from.on("end", () => {
    ended = true;
    if (!timer && queue.length === 0 && !to.destroyed) to.end();
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
  // Half-open sockets: when one side has finished sending, the reply still queued for it is delivered first.
  const server: Server = createServer({ allowHalfOpen: true }, (client) => {
    accepted++;
    const upstream = createConnection({
      port: o.targetPort,
      host: o.targetHost ?? "127.0.0.1",
      allowHalfOpen: true,
    });
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
    // Only a broken connection tears down the other side at once; a normal close goes through the queue.
    client.on("close", (hadError) => {
      if (hadError) kill();
    });
    upstream.on("close", (hadError) => {
      if (hadError) kill();
    });
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
