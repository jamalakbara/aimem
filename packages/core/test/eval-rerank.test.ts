import { parseRerankOrder } from "@aimem/core";
import { expect, it } from "vitest";

it("accepts only the requested number of distinct candidate refs", () => {
  expect(parseRerankOrder('["c","a"]', ["a", "b", "c"], 2)).toEqual(["c", "a", "b"]);
  for (const text of [
    '["c","c"]',
    '["c","unknown"]',
    '["c"]',
    '{"refs":["a","b"]}',
    '```json\n["a","b"]\n```',
    "[1,2]",
  ]) {
    expect(parseRerankOrder(text, ["a", "b", "c"], 2)).toBeUndefined();
  }
});

it("allows fewer results only when the candidate pool itself is smaller", () => {
  expect(parseRerankOrder('["b","a"]', ["a", "b"], 10)).toEqual(["b", "a"]);
  expect(parseRerankOrder("[]", [], 10)).toEqual([]);
});
