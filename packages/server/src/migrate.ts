import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inTx, type Pool } from "./db.js";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Apply the numbered SQL files that are not applied yet, each in its own transaction. */
export async function migrate(pool: Pool): Promise<string[]> {
  const files = (await readdir(DIR)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const done = await inTx(pool, async (c) => {
      // Two servers starting together must not apply the same file twice.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('aimem:migrate', 0))");
      await c.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
      );
      const seen = await c.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (seen.rowCount) return false;
      await c.query(await readFile(`${DIR}${file}`, "utf8"));
      await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      return true;
    });
    if (done) applied.push(file);
  }
  return applied;
}
