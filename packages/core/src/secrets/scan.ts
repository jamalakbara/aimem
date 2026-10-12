import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Fs } from "../ports.js";

/** A possible secret. Never carries the matched text, only where it is and a fingerprint (09 §4). */
export interface SecretFinding {
  kind: string;
  /** 1-based line number in the scanned text. */
  line: number;
  /** `sha256:<16 hex>` of the match; add it to `.aimem/secretignore` to accept a false positive. */
  fingerprint: string;
}

const PLACEHOLDER = /^(<.*>|\$\{.*\}|\{\{.*|\$[A-Z_]+|x{4,}|\*{4,}|changeme|your[-_].*)$/i;

const PATTERNS: [string, RegExp, ((m: RegExpExecArray) => boolean)?][] = [
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["api-key", /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{20,})/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["connection-string", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@[^\s/]+/g],
  [
    "assigned-secret",
    /\b(?:api[_-]?key|secret|token|passwd|password|client[_-]?secret)\b["']?\s*[:=]\s*["']?([^\s"']{12,})/gi,
    (m) => !PLACEHOLDER.test(m[1] ?? ""),
  ],
];

const TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/** Long tokens mixing letters and digits with high entropy. Hex (≤ 4 bits/char) never qualifies. */
function looksRandom(t: string): boolean {
  return /[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t) && entropy(t) > 4.5;
}

const fingerprint = (match: string) =>
  `sha256:${createHash("sha256").update(match).digest("hex").slice(0, 16)}`;

/** Scan text for likely secrets, skipping fingerprints in `ignore`. */
export function scanSecrets(text: string, ignore: ReadonlySet<string> = new Set()): SecretFinding[] {
  const out: SecretFinding[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  lines.forEach((lineText, i) => {
    const add = (kind: string, match: string) => {
      const fp = fingerprint(match);
      const key = `${i}:${kind}:${fp}`;
      if (ignore.has(fp) || seen.has(key)) return;
      seen.add(key);
      out.push({ kind, line: i + 1, fingerprint: fp });
    };
    const matched: string[] = [];
    for (const [kind, re, accept] of PATTERNS) {
      for (const m of lineText.matchAll(re)) {
        if (accept && !accept(m as RegExpExecArray)) continue;
        add(kind, m[0]);
        matched.push(m[0]);
      }
    }
    for (const m of lineText.matchAll(TOKEN)) {
      if (looksRandom(m[0]) && !matched.some((x) => x.includes(m[0]) || m[0].includes(x)))
        add("high-entropy", m[0]);
    }
  });
  return out;
}

/** Fingerprints listed in `.aimem/secretignore` (one per line; `#` starts a comment). */
export async function loadSecretIgnore(fs: Fs, aimemDir: string): Promise<Set<string>> {
  let text: string;
  try {
    text = await fs.readFile(join(aimemDir, "secretignore"));
  } catch {
    return new Set();
  }
  return new Set(
    text
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .filter(Boolean),
  );
}
