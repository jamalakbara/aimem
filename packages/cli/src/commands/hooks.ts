import {
  AimemError,
  hookState,
  INDEX_HOOKS,
  installIndexHooks,
  loadProject,
  uninstallIndexHooks,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

/** `aimem hooks install|uninstall|status` (07 §1 rule 5): keep the generated INDEX.md merge-safe. */
export async function hooks(deps: CliDeps, g: GlobalOptions, act: string): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  if (act === "install" || act === "uninstall") {
    const r =
      act === "install"
        ? await installIndexHooks(deps.git, deps.fs, nb.root)
        : await uninstallIndexHooks(deps.git, deps.fs, nb.root);
    const state = await hookState(deps.git, deps.fs, nb.root);
    return {
      data: { changed: r.changed, ...state },
      text: r.changed.length
        ? `${act === "install" ? "Installed" : "Removed"}: ${r.changed.join(", ")}\n`
        : "Nothing to change.\n",
    };
  }
  if (act === "status") {
    const s = await hookState(deps.git, deps.fs, nb.root);
    const missing = INDEX_HOOKS.filter((h) => !s.installed.includes(h));
    return {
      data: s,
      text: [
        `hooks: ${s.installed.length ? s.installed.join(", ") : "none"}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
        `merge.ours.driver: ${s.mergeDriver ? "set" : "not set"}`,
        `.gitattributes INDEX.md merge=ours: ${s.attribute ? "yes" : "no"}`,
      ]
        .join("\n")
        .concat("\n"),
    };
  }
  throw new AimemError("USAGE", `unknown hooks action '${act}' (expected install, uninstall or status)`);
}
