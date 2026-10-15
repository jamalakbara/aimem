import type { ProjectConfig } from "@aimem/schema";
import type { Rec } from "./store.js";

export type Freshness = "fresh" | "stale" | "expired";
const DAY = 86_400_000;

export function freshnessOf(rec: Rec, config: ProjectConfig, now: Date): Freshness {
  const { expires, verified, created, type } = rec.fm;
  if (expires && Date.parse(`${expires}T23:59:59Z`) < now.getTime()) return "expired";
  const window = config.freshness_days[type];
  if (!window) return "fresh";
  const base = Date.parse(verified ? `${verified}T00:00:00Z` : created);
  return now.getTime() - base > window * DAY ? "stale" : "fresh";
}
export const FRESHNESS_WEIGHT: Record<Freshness, number> = { fresh: 1.0, stale: 0.6, expired: 0.3 };
