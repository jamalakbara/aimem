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
  /**
   * Replaces the COMMIT statement. Tests use it to run the real COMMIT and then lose its confirmation, the one
   * failure whose outcome the server cannot know.
   */
  commit?(client: Client): Promise<void>;
  /** After commit, before the response. `drop` closes the connection without an answer (a lost response). */
  afterCommit?(info: { op: HookInfo["op"]; task: string; drop(): void }): Promise<void> | void;
  /**
   * Points of an SSE stream: `registered` after it listens and before it reads anything, `backlog` after its first
   * read of the table and before it sends that read (EV-4).
   */
  stream?(point: "registered" | "backlog", info: { projectId: string }): Promise<void> | void;
}
