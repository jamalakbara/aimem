import { dirname, join, relative, resolve } from "node:path";
import { type Fs, toPosix } from "@aimem/core";

interface BuildCheck {
  name: string;
  status: "ok" | "warn" | "info";
  detail: string;
}
const missing = (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "ENOENT";

/** Compare this binary's development source/output pairs, never the target notebook's source. */
export async function developmentBuildCheck(fs: Fs, entry?: string): Promise<BuildCheck | undefined> {
  if (!entry) return undefined;
  const root = resolve(dirname(entry), "../../..");
  if (toPosix(relative(root, resolve(entry))) !== "packages/cli/dist/bin.js") return undefined;
  try {
    const metadata: unknown = JSON.parse(await fs.readFile(join(root, "package.json")));
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("name" in metadata) ||
      metadata.name !== "aimem-monorepo"
    )
      return undefined;
  } catch {
    return undefined;
  }
  const name = "development build";
  const stat = fs.stat;
  if (!stat)
    return {
      name,
      status: "info",
      detail: "source/build timestamps are unavailable in this filesystem adapter",
    };
  try {
    const sources: { source: string; built: string; mtime: number }[] = [];
    for (const pkg of ["schema", "core", "adapters", "mcp", "cli"]) {
      const sourceRoot = join(root, "packages", pkg, "src");
      let names: string[];
      try {
        names = await fs.readdir(sourceRoot);
      } catch (e) {
        if (missing(e)) continue;
        throw e;
      }
      const walk = async (dir: string, entries: string[], depth: number): Promise<void> => {
        if (depth > 16 || sources.length > 2000) throw new Error("diagnostic bound exceeded");
        for (const file of entries.sort()) {
          const path = join(dir, file);
          const info = await stat(path);
          if (info.isDirectory) await walk(path, await fs.readdir(path), depth + 1);
          else if (file.endsWith(".ts") && !file.endsWith(".d.ts"))
            sources.push({
              source: path,
              built: join(root, "packages", pkg, "dist", relative(sourceRoot, path).replace(/\.ts$/, ".js")),
              mtime: info.mtimeMs,
            });
        }
      };
      await walk(sourceRoot, names, 0);
    }
    if (!sources.length) return { name, status: "info", detail: "development source tree is unavailable" };
    let stale = 0;
    for (const source of sources) {
      try {
        const built = await stat(source.built);
        if (!Number.isFinite(source.mtime) || !Number.isFinite(built.mtimeMs))
          throw new Error("invalid timestamps");
        if (built.isDirectory || source.mtime > built.mtimeMs) stale++;
      } catch (e) {
        if (missing(e)) stale++;
        else throw e;
      }
    }
    return stale
      ? {
          name,
          status: "warn",
          detail: `${stale} source files have missing or older build output; run pnpm build in ${toPosix(root)}`,
        }
      : { name, status: "ok", detail: "development build matches source modification times" };
  } catch {
    return { name, status: "info", detail: "could not inspect all development source/build timestamps" };
  }
}
