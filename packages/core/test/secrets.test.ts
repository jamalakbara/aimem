import { scanSecrets } from "@aimem/core";
import { describe, expect, it } from "vitest";

// Fake secrets are assembled at runtime so the repository never contains a full key-shaped string.
const j = (...parts: string[]) => parts.join("");
const rnd40 = "Zq8xW3vN0pLk7Rt2Yb5Mc9Hd4Fg6Js1Aa3Ee5Ii7"; // fixed, high-entropy, not a real credential

const POSITIVE: [string, string][] = [
  ["aws-access-key", j("AKIA", "IOSFODNN7", "EXAMPLE")],
  ["aws-access-key", j("ASIA", "Z2QWERTY12345678")],
  ["private-key", j("-----BEGIN ", "RSA PRIVATE KEY-----")],
  ["private-key", j("-----BEGIN ", "OPENSSH PRIVATE KEY-----")],
  ["github-token", j("gh", "p_", rnd40.slice(0, 36))],
  ["github-token", j("github", "_pat_", rnd40, rnd40.slice(0, 20))],
  ["slack-token", j("xo", "xb-", "1234567890-abcdefghij")],
  ["api-key", j("sk", "_live_", rnd40.slice(0, 24))],
  ["api-key", j("s", "k-", rnd40.slice(0, 32))],
  ["google-api-key", j("AI", "za", rnd40.slice(0, 35))],
  [
    "jwt",
    j(
      "ey",
      "JhbGciOiJIUzI1NiJ9.",
      "ey",
      "JzdWIiOiIxMjM0NTY3ODkwIn0.",
      "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ),
  ],
  ["connection-string", j("postgres://", "ledger:", "s3cr3tPassw0rd", "@db.internal:5432/ledger")],
  ["assigned-secret", j("pass", "word = ", "correct-horse-battery-staple")],
  ["assigned-secret", j("client_", "secret: ", "9f8e7d6c5b4a3210ffee")],
  ["high-entropy", j("token value ", rnd40, "xY9")],
];

const NEGATIVE: string[] = [
  "commit 3f9a1b2c4d5e6f708192a3b4c5d6e7f8091a2b3c", // git sha (hex)
  "content_sha: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", // sha256 hex
  "request id 123e4567-e89b-12d3-a456-426614174000", // uuid
  "see dec-7k3m9q2x and tsk-3f9a1b2c",
  "docs/14-decisions-and-open-questions.md",
  "https://github.com/jamalakbara/aimem/pull/5",
  "password: <your-password>",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder text the scanner must ignore
  "token: ${AIMEM_TOKEN}",
  "api_key = {{ secrets.API_KEY }}",
  "budget_tokens: 4000",
  "The secret to good records is keeping them short.",
  "Use the sk- prefix only for test keys.",
  "postgres://localhost:5432/ledger",
  "Run pnpm lint && pnpm typecheck && pnpm test before pushing.",
  "Anggaran token dihitung dengan chars/4 untuk semua briefing.",
];

describe("scanSecrets (09 §4)", () => {
  it.each(POSITIVE)("detects %s", (kind, secret) => {
    const findings = scanSecrets(`first line\nprefix ${secret} suffix\nlast line\n`);
    expect(findings.map((f) => f.kind)).toContain(kind);
    expect(findings.find((f) => f.kind === kind)?.line).toBe(2);
  });

  it.each(NEGATIVE)("does not flag %j", (text) => {
    expect(scanSecrets(text)).toEqual([]);
  });

  it("never includes the secret text in findings", () => {
    for (const [, secret] of POSITIVE) {
      for (const f of scanSecrets(secret)) expect(JSON.stringify(f)).not.toContain(secret.slice(4, 16));
    }
  });

  it("gives a stable fingerprint that the ignore list can suppress", () => {
    const text = `key ${POSITIVE[0]?.[1]}`;
    const [first] = scanSecrets(text);
    expect(first?.fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(scanSecrets(text)[0]?.fingerprint).toBe(first?.fingerprint);
    expect(scanSecrets(text, new Set([first?.fingerprint as string]))).toEqual([]);
  });
});
