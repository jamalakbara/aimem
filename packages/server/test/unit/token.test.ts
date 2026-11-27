import { scanSecrets } from "@aimem/core";
import { hashToken, newToken, TOKEN_RE } from "@aimem/server";
import { describe, expect, it } from "vitest";

describe("tokens (plan A5, QA W8)", () => {
  it("are aimem_ and 43 base64url characters, distinct, and found by the secret scanner", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = newToken();
      expect(t).toMatch(TOKEN_RE);
      expect(t).toHaveLength(49);
      seen.add(t);
      expect(scanSecrets(t).map((f) => f.kind)).toContain("aimem-token");
    }
    expect(seen.size).toBe(1000);
  });
  it("are stored as SHA-256 hex", () => {
    const t = newToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t.slice(6, 20));
  });
});
