import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

/** File system operations core needs. Injected so tests can simulate failures (docs/11 §3). */
export interface Fs {
  /** Optional development-build diagnostic metadata; no file contents. */
  stat?(path: string): Promise<{ mtimeMs: number; isDirectory: boolean; isFile?: boolean; size?: number }>;
  /** Like `stat`, but describes a symlink itself instead of its target (adopt never follows links). */
  lstat?(path: string): Promise<{
    isDirectory: boolean;
    isSymbolicLink: boolean;
    isFile?: boolean;
    size?: number;
    mtimeMs?: number;
    ctimeMs?: number;
    ino?: number;
  }>;
  /** Absolute path with every symlink resolved. */
  realpath?(path: string): Promise<string>;
  /** Optional for older injected filesystems; metadata logging is best effort. */
  appendFile?(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  /**
   * Like `readFile`, but only for a regular file of at most `maxBytes` that is not a link, checked on the opened
   * file itself, so a swap after an earlier check cannot make it wait on a FIFO or read another file.
   * Rejects with `ENOTREG`, `EFBIG`, `ELOOP` or the system error.
   */
  readRegular?(path: string, maxBytes: number): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  /** Creates the file only if it does not exist yet (atomic); rejects with EEXIST otherwise. */
  createExclusive?(path: string, data: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  /** Creates the directory and any missing parents. */
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  /** Optional; used to make installed git hooks executable. */
  chmod?(path: string, mode: number): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Random {
  bytes(n: number): Uint8Array;
}

const failed = (code: string, path: string) => Object.assign(new Error(`${code}: ${path}`), { code });

async function readRegular(path: string, maxBytes: number): Promise<string> {
  // Windows has neither flag; it has no FIFOs in folders, and callers check links with lstat first.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const file = await open(path, flags);
  try {
    if (!(await file.stat()).isFile()) throw failed("ENOTREG", path);
    const chunks: Buffer[] = [];
    let total = 0;
    // Read to the end instead of trusting the size: the file may grow meanwhile.
    for (;;) {
      const { bytesRead, buffer } = await file.read(Buffer.allocUnsafe(64 * 1024), 0, 64 * 1024, null);
      if (bytesRead === 0) return Buffer.concat(chunks).toString("utf8");
      total += bytesRead;
      if (total > maxBytes) throw failed("EFBIG", path);
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
}

export const nodeFs: Fs = {
  stat: async (path) => {
    const s = await stat(path);
    return { mtimeMs: s.mtimeMs, isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size };
  },
  lstat: async (path) => {
    const s = await lstat(path);
    return {
      isDirectory: s.isDirectory(),
      isSymbolicLink: s.isSymbolicLink(),
      isFile: s.isFile(),
      size: s.size,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
      ino: s.ino,
    };
  },
  realpath: (p) => realpath(p),
  appendFile: (p, d) => appendFile(p, d, "utf8"),
  readFile: (p) => readFile(p, "utf8"),
  readRegular,
  writeFile: (p, d) => (typeof d === "string" ? writeFile(p, d, "utf8") : writeFile(p, d)),
  createExclusive: (p, d) => writeFile(p, d, { encoding: "utf8", flag: "wx" }),
  readBytes: async (p) => new Uint8Array(await readFile(p)),
  rename: (a, b) => rename(a, b),
  unlink: (p) => unlink(p),
  mkdir: async (p) => {
    await mkdir(p, { recursive: true });
  },
  readdir: (p) => readdir(p),
  chmod: (p, m) => chmod(p, m),
};

export const systemClock: Clock = { now: () => new Date() };

export const cryptoRandom: Random = { bytes: (n) => new Uint8Array(randomBytes(n)) };
