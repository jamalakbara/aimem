import {
  type AdapterResult,
  adapterStatus,
  removeAdapters,
  syncAdapters,
  TARGET_NAMES,
  type TargetName,
} from "@aimem/adapters";
import { AimemError, loadProject, setProjectValue } from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";

function parseTargets(list: string | undefined): TargetName[] | undefined {
  if (list === undefined) return undefined;
  const names = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const n of names) {
    if (!(TARGET_NAMES as string[]).includes(n))
      throw new AimemError("USAGE", `unknown adapter target '${n}' (known: ${TARGET_NAMES.join(", ")})`);
  }
  return names as TargetName[];
}

function report(results: AdapterResult[]): CommandResult {
  const text = results.length
    ? `${results.map((r) => `${r.action.padEnd(9)} ${r.file}${r.note ? ` (${r.note})` : ""}`).join("\n")}\n`
    : "No adapter files.\n";
  const broken = results.filter((r) => r.action === "broken");
  return {
    data: { results },
    text,
    ...(broken.length
      ? {
          failure: {
            code: "USAGE",
            message: `${broken.map((b) => b.file).join(", ")}: broken aimem block (${broken[0]?.note}); fix by hand, other files were processed`,
            details: { results },
          },
        }
      : {}),
  };
}

/** `aimem adapters list|sync|remove|add` (04 §2, 06 §4). */
export async function adapters(
  deps: CliDeps,
  g: GlobalOptions,
  action: string,
  o: { targets?: string; file?: string },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const targets = parseTargets(o.targets);
  const w = { fs: deps.fs, random: deps.random };
  const configured = (nb.config.adapters ?? {}) as { targets?: TargetName[]; files?: string[] };
  switch (action) {
    case "list": {
      const status = await adapterStatus(nb, deps.fs, targets ? { targets } : {});
      return {
        data: { adapters: status },
        text: status.length
          ? `${status.map((s) => `${s.state.padEnd(13)} ${s.target.padEnd(8)} ${s.file}`).join("\n")}\n`
          : "No adapters configured.\n",
      };
    }
    case "sync": {
      const results = await syncAdapters(nb, w, targets ? { targets } : {});
      if (targets) await setProjectValue(deps.fs, nb, ["adapters", "targets"], targets, deps.random);
      return report(results);
    }
    case "add": {
      if (!o.file) throw new AimemError("USAGE", "adapters add needs --file <path>");
      const results = await syncAdapters(nb, w, { targets: [], files: [o.file] });
      const files = [...new Set([...(configured.files ?? []), ...results.map((r) => r.file)])];
      await setProjectValue(deps.fs, nb, ["adapters", "files"], files, deps.random);
      return report(results);
    }
    case "remove": {
      const results = await removeAdapters(nb, w, targets ? { targets } : {});
      const remaining = targets ? (configured.targets ?? []).filter((t) => !targets.includes(t)) : [];
      await setProjectValue(deps.fs, nb, ["adapters", "targets"], remaining, deps.random);
      if (!targets && configured.files?.length)
        await setProjectValue(deps.fs, nb, ["adapters", "files"], [], deps.random);
      return report(results);
    }
    default:
      throw new AimemError(
        "USAGE",
        `unknown adapters action '${action}' (expected list, sync, remove or add)`,
      );
  }
}
