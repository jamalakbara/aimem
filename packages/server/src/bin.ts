#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createToken, revokeToken } from "./admin.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { startServer } from "./server.js";

/**
 * Operator commands (plan A6). `DATABASE_URL` comes from the environment and is never printed.
 *   migrate
 *   serve [--port <n>]
 *   token create --project <slug> --user <handle> --kind human|agent [--name <agent>] --scopes read,write:live [--expires <ISO time>]
 *   token revoke --id <id>
 */
const USAGE = "usage: aimem-server migrate | serve [--port N] | token create … | token revoke --id N";

async function main(argv: string[]): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL is not set.\n");
    return 2;
  }
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      project: { type: "string" },
      "project-name": { type: "string" },
      user: { type: "string" },
      kind: { type: "string" },
      name: { type: "string" },
      scopes: { type: "string" },
      expires: { type: "string" },
      id: { type: "string" },
    },
  });
  const [cmd, sub] = positionals;
  if (cmd === "serve") {
    const port = Number(values.port ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      process.stderr.write("--port must be 0–65535.\n");
      return 2;
    }
    const server = await startServer({
      databaseUrl: url,
      port,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(`aimem server listening on ${server.url}\n`);
    await new Promise<void>((done) => {
      for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => done());
    });
    await server.close();
    return 0;
  }
  const pool = createPool(url, 2);
  try {
    if (cmd === "migrate") {
      const applied = await migrate(pool);
      process.stderr.write(applied.length ? `Applied ${applied.join(", ")}.\n` : "Up to date.\n");
      return 0;
    }
    if (cmd === "token" && sub === "create") {
      const kind = values.kind === "agent" ? "agent" : values.kind === "human" ? "human" : undefined;
      if (!values.project || !values.user || !kind || values.scopes === undefined) {
        process.stderr.write(`${USAGE}\n`);
        return 2;
      }
      const expiresAt = values.expires ? new Date(values.expires) : undefined;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        process.stderr.write("--expires must be an ISO time.\n");
        return 2;
      }
      const { id, token } = await createToken(pool, {
        project: values.project,
        ...(values["project-name"] ? { projectName: values["project-name"] } : {}),
        user: values.user,
        kind,
        ...(values.name ? { name: values.name } : {}),
        scopes: values.scopes.split(",").filter(Boolean),
        ...(expiresAt ? { expiresAt } : {}),
      });
      // The token is shown once, alone on stdout, so it can be piped into a secret store.
      process.stderr.write(`Created token ${id}. It is shown once; store it now.\n`);
      process.stdout.write(`${token}\n`);
      return 0;
    }
    if (cmd === "token" && sub === "revoke" && values.id) {
      const done = await revokeToken(pool, values.id);
      process.stderr.write(done ? `Revoked token ${values.id}.\n` : `No active token ${values.id}.\n`);
      return done ? 0 : 1;
    }
    process.stderr.write(`${USAGE}\n`);
    return 2;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error && !("code" in e) ? e.message : "database error"}\n`);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main(process.argv.slice(2));
