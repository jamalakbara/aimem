import pg from "pg";
import type { Pool } from "./db.js";

/** The channel of `pg_notify` in claims.ts; a notification carries `{project_id, seq}` only (QA W7). */
export const EVENT_CHANNEL = "aimem_events";
/** Name of the LISTEN connection in `pg_stat_activity`; tests cut it by this name (EV-5). */
export const LISTEN_APPLICATION_NAME = "aimem-listen";

/** The part of a pg client that the hub uses; tests replace it to check reconnects without a database. */
export interface ListenClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  /** `notification` passes `{channel, payload}`; `error` and `end` pass nothing that is used. */
  // biome-ignore lint/suspicious/noExplicitAny: the pg client's listener signatures differ per event
  on(event: "notification" | "error" | "end", fn: (...a: any[]) => void): unknown;
}

export interface HubOptions {
  /** First wait before reconnecting; doubled after each failure up to `reconnectMaxMs` (plan §5). */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** While LISTEN is down every subscriber reads the table at this interval (plan §5, EV-5 ≤ 3 s). */
  pollMs?: number;
  /** Builds the LISTEN connection; by default a pg client with the pool's settings. */
  connect?: () => ListenClient;
}

type Wake = () => void;

/**
 * One LISTEN connection per server instance. A notification only wakes the subscribers of its project; they read
 * `seq > last sent` from the events table, so a lost or reordered notification never loses an event (plan §5).
 */
export class EventHub {
  private readonly subs = new Map<string, Set<Wake>>();
  private client: ListenClient | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private delay: number;
  private closed = false;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly pollMs: number;
  private readonly make: () => ListenClient;

  constructor(pool: Pool, o: HubOptions = {}) {
    this.minMs = o.reconnectMinMs ?? 250;
    this.maxMs = o.reconnectMaxMs ?? 5_000;
    this.pollMs = o.pollMs ?? 1_000;
    this.delay = this.minMs;
    this.make =
      o.connect ??
      (() =>
        new pg.Client({
          ...(pool as unknown as { options: pg.ClientConfig }).options,
          application_name: LISTEN_APPLICATION_NAME,
          keepAlive: true,
        }) as unknown as ListenClient);
  }

  /** True while the LISTEN connection is up. */
  get listening(): boolean {
    return this.client !== undefined;
  }

  /** Number of registered subscribers (connection cleanup tests). */
  get size(): number {
    let n = 0;
    for (const s of this.subs.values()) n += s.size;
    return n;
  }

  /** The first connection attempt; a failure does not throw, it starts polling and reconnects later. */
  async start(): Promise<void> {
    await this.connect();
  }

  /** Registers a subscriber before it reads its backlog (plan §5 step 2); returns the unregister function. */
  subscribe(projectId: string, wake: Wake): () => void {
    let set = this.subs.get(projectId);
    if (!set) {
      set = new Set();
      this.subs.set(projectId, set);
    }
    set.add(wake);
    return () => {
      const s = this.subs.get(projectId);
      s?.delete(wake);
      if (s && s.size === 0) this.subs.delete(projectId);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    const c = this.client;
    this.client = undefined;
    await c?.end().catch(() => undefined);
  }

  private wakeProject(projectId: string): void {
    for (const w of this.subs.get(projectId) ?? []) w();
  }

  private wakeAll(): void {
    for (const set of this.subs.values()) for (const w of set) w();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const c = this.make();
    let failed = false;
    const lost = () => {
      if (failed) return;
      failed = true;
      if (this.client === c) this.client = undefined;
      c.end().catch(() => undefined);
      this.down();
    };
    c.on("error", lost);
    c.on("end", lost);
    c.on("notification", (n: { channel: string; payload?: string }) => {
      if (n.channel !== EVENT_CHANNEL || !n.payload) return;
      try {
        const { project_id } = JSON.parse(n.payload) as { project_id?: unknown };
        if (project_id !== undefined) this.wakeProject(String(project_id));
      } catch {
        // Not ours; the table stays the source of truth.
      }
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${EVENT_CHANNEL}`);
    } catch {
      lost();
      return;
    }
    if (failed || this.closed) {
      await c.end().catch(() => undefined);
      return;
    }
    this.client = c;
    this.delay = this.minMs;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    // Events committed while LISTEN was down: every subscriber catches up from the table.
    this.wakeAll();
  }

  /** LISTEN is gone: poll the table until it is back, and reconnect with backoff (plan §5, EV-5). */
  private down(): void {
    if (this.closed) return;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => this.wakeAll(), this.pollMs);
      this.pollTimer.unref();
    }
    if (this.reconnectTimer) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, this.maxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, wait);
    this.reconnectTimer.unref();
  }
}
