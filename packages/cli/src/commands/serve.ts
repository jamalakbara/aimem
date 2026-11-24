import { AimemError } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

const DEFAULT_PORT = 4747;

/** `aimem serve web` (04 §5, 24 §5.1): runs until Ctrl-C. */
export async function serveWeb(
  deps: CliDeps,
  g: GlobalOptions,
  o: { port?: string },
): Promise<CommandResult> {
  const text = o.port ?? String(DEFAULT_PORT);
  const port = Number(text);
  if (!/^\d{1,5}$/.test(text) || port > 65535)
    throw new AimemError("USAGE", "--port must be a number from 0 to 65535");
  if (!deps.serveWeb) throw new AimemError("USAGE", "the web viewer is not available in this build");
  const { url } = await deps.serveWeb({
    dir: g.dir,
    port,
    // Printed at once, not when the command ends; --json keeps stdout for the envelope.
    ready: (u) => (g.json ? deps.stderr : deps.stdout)(`Viewer (read-only): ${u}\nPress Ctrl-C to stop.\n`),
  });
  return { data: { url }, text: "" };
}
