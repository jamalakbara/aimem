import pg from "pg";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export const createPool = (connectionString: string, max = 10): Pool =>
  new pg.Pool({ connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });

/** One transaction on one client; rolled back on any error, the client released either way. */
export async function inTx<T>(
  pool: Pool,
  fn: (client: Client) => Promise<T>,
  mode = "BEGIN ISOLATION LEVEL READ COMMITTED",
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query(mode);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw e;
  } finally {
    // A client whose connection failed must not go back to the pool.
    client.release(broken ? true : undefined);
  }
}

/** Errors that mean "the database is not reachable right now", as opposed to a bug. */
export function unavailable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && (code.startsWith("08") || code.startsWith("57P") || code.startsWith("53")))
    return true;
  if (typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(code))
    return true;
  const message = e instanceof Error ? e.message : "";
  return /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/.test(
    message,
  );
}
