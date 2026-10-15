const PATTERNS: Array<[string, RegExp]> = [
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["assigned-secret", /\b(?:api[_-]?key|secret|token|passwd|password|client[_-]?secret)\b["']?\s*[:=]\s*["']?[A-Za-z0-9/+_\-.]{16,}/i],
];

/** Returns names of detected secret kinds (never the matched value). */
export function scanSecrets(text: string): string[] {
  const found: string[] = [];
  for (const [name, re] of PATTERNS) if (re.test(text)) found.push(name);
  return found;
}
