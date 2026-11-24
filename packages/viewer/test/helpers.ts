import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Fs, nodeFs } from "@aimem/core";
import { startViewer, type Viewer } from "@aimem/viewer";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/projects/", import.meta.url));
const cleanup: (() => unknown)[] = [];

/** A throw-away copy of a fixture project. */
export function notebook(name = "tiny"): string {
  const dir = mkdtempSync(join(tmpdir(), "aimem-viewer-"));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}
export async function viewer(
  dir: string,
  o: { fs?: Fs; timeoutMs?: number; loadMs?: number } = {},
): Promise<Viewer> {
  const v = await startViewer({
    fs: nodeFs,
    clock: { now: () => new Date("2026-10-12T00:00:00Z") },
    cacheHome: join(dir, "no-cache-home"),
    dir,
    port: 0,
    ...o,
  });
  cleanup.unshift(() => v.close());
  return v;
}
export async function clean() {
  for (const f of cleanup.splice(0)) await f();
}

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
export const get = (
  v: Viewer,
  path: string,
  o: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> =>
  new Promise((done, fail) => {
    const r = request(
      {
        host: "127.0.0.1",
        port: v.port,
        path,
        method: o.method ?? "GET",
        headers: o.headers ?? {},
        agent: false,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    r.on("error", fail);
    r.end(o.body);
  });

/** Sends exact bytes and returns everything the server answered until it closed the connection. */
export const raw = (v: Viewer, text: string, waitMs = 700): Promise<string> =>
  new Promise((done) => {
    let out = "";
    const s = connect(v.port, "127.0.0.1", () => s.write(text));
    s.on("data", (d) => {
      out += d;
    });
    s.on("error", () => undefined);
    s.on("close", () => done(out));
    setTimeout(() => s.destroy(), waitMs);
  });
