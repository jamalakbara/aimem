import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

/** File system operations core needs. Injected so tests can simulate failures (docs/11 §3). */
export interface Fs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  /** Creates the directory and any missing parents. */
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
}

export interface Clock {
  now(): Date;
}

export interface Random {
  bytes(n: number): Uint8Array;
}

export const nodeFs: Fs = {
  readFile: (p) => readFile(p, "utf8"),
  writeFile: (p, d) => writeFile(p, d, "utf8"),
  rename: (a, b) => rename(a, b),
  unlink: (p) => unlink(p),
  mkdir: async (p) => {
    await mkdir(p, { recursive: true });
  },
  readdir: (p) => readdir(p),
};

export const systemClock: Clock = { now: () => new Date() };

export const cryptoRandom: Random = { bytes: (n) => new Uint8Array(randomBytes(n)) };
