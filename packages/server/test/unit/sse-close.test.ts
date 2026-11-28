import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readCursor, Streams } from "@aimem/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Close lifecycle of an SSE stream (QA 6.1b N1, CI review of #122), with isolated stand-ins for the request, the
 * response and its socket, and fake timers: the same on every OS. Node detaches the socket from a response once
 * the response has finished (`res.socket = null`), after which `res.destroy()` no longer reaches the connection;
 * the stand-in response does the same.
 */
class FakeSocket extends EventEmitter {
  destroyed = false;
  writableLength = 0;
  destroyCalls = 0;
  destroy() {
    this.destroyCalls++;
    this.destroyed = true;
    this.emit("close");
  }
}

class FakeRes extends EventEmitter {
  socket: FakeSocket | null;
  headers: Record<string, string> = {};
  status = 0;
  destroyed = false;
  closed = false;
  writableEnded = false;
  writableFinished = false;
  writableLength = 0;
  destroyCalls = 0;
  written: string[] = [];
  /** What `end()` leads to: the response finishes at once (and Node detaches the socket), or stays unfinished. */
  constructor(
    socket: FakeSocket,
    private readonly onEnd: "finish" | "pending",
  ) {
    super();
    this.socket = socket;
  }
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.written.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    if (this.onEnd === "finish") {
      this.writableFinished = true;
      this.socket = null; // as Node's resOnFinish → detachSocket()
      this.emit("finish");
    }
  }
  destroy() {
    // A detached response no longer reaches its socket, as in Node.
    this.destroyCalls++;
    this.destroyed = true;
  }
}

const db = {
  async query(sql: string) {
    if (sql.includes("FROM events")) return { rows: [] };
    if (sql.includes("project_event_seq")) return { rows: [{ last_seq: "0" }] };
    return { rows: [{ ok: 1 }] }; // access check
  },
};
const hub = { subscribe: () => () => undefined };
const CALLER = { projectId: "1", slug: "alpha", userId: "7", holder: "human:dana", tokenId: "9" };
const WAIT = 300;

async function open(onEnd: "finish" | "pending") {
  const socket = new FakeSocket();
  const res = new FakeRes(socket, onEnd);
  const req = Object.assign(new EventEmitter(), { rawHeaders: [] as string[] }) as unknown as IncomingMessage;
  const streams = new Streams(db, hub, { drainWaitMs: WAIT, pingMs: 60_000 });
  await streams.start(
    req,
    res as unknown as ServerResponse,
    CALLER,
    readCursor(req as never, new URL("http://x/events")),
  );
  expect(res.status).toBe(200);
  return { socket, res, streams };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a closed stream's connection is gone after the wait (QA 6.1b N1)", () => {
  it("bytes still wait in the socket after the response finished: the socket itself is cut", async () => {
    const { socket, res, streams } = await open("finish");
    socket.writableLength = 4_096;
    streams.closeAll();
    expect(res.socket).toBeNull(); // detached, so res.destroy() alone could not close it
    await vi.advanceTimersByTimeAsync(WAIT - 1);
    expect(socket.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.destroyed).toBe(true);
  });

  it("the response never finished (a reader that takes nothing): the socket is cut", async () => {
    const { socket, streams } = await open("pending");
    streams.closeAll();
    await vi.advanceTimersByTimeAsync(WAIT);
    expect(socket.destroyed).toBe(true);
  });

  it("nothing left to send, but the client keeps the connection open: it is cut too", async () => {
    const { socket, streams } = await open("finish");
    streams.closeAll();
    await vi.advanceTimersByTimeAsync(WAIT);
    expect(socket.destroyed).toBe(true);
  });

  it("a connection the client already closed is not touched again", async () => {
    const { socket, streams } = await open("finish");
    streams.closeAll();
    socket.destroyed = true;
    await vi.advanceTimersByTimeAsync(WAIT * 2);
    expect(socket.destroyCalls).toBe(0);
  });

  it("the stream's connection serves no other response: it is sent with Connection: close", async () => {
    const { res } = await open("finish");
    expect(res.headers.Connection).toBe("close");
  });

  it("a stream refused before its 200 never cuts anything", async () => {
    const socket = new FakeSocket();
    const res = new FakeRes(socket, "finish");
    const req = Object.assign(new EventEmitter(), {
      rawHeaders: [] as string[],
    }) as unknown as IncomingMessage;
    const streams = new Streams(db, hub, { drainWaitMs: WAIT, maxStreams: 0 });
    await expect(
      streams.start(req, res as unknown as ServerResponse, CALLER, undefined),
    ).rejects.toMatchObject({
      status: 503,
    });
    await vi.advanceTimersByTimeAsync(WAIT * 2);
    expect([socket.destroyCalls, res.destroyCalls]).toEqual([0, 0]);
  });
});
