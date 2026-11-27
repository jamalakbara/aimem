import type { Client } from "./db.js";

/** Points inside a claim transaction, in order. Tests block or fail here to prove ordering and rollback. */
export type HookPoint = "locked" | "read" | "seq" | "beforeEvent" | "beforeCommit";

export interface HookInfo {
  op: "acquire" | "heartbeat" | "release";
  task: string;
  client: Client;
}

export interface Hooks {
  at?(point: HookPoint, info: HookInfo): Promise<void> | void;
  /** After commit, before the response. `drop` closes the connection without an answer (a lost response). */
  afterCommit?(info: { op: HookInfo["op"]; task: string; drop(): void }): Promise<void> | void;
}
