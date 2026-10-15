const cache = new Map<string, RegExp>();

/** `**` any depth, `*` within one segment, `?` one character. A trailing `/**` also matches the folder itself. */
export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  const trailing = glob.endsWith("/**");
  const g = trailing ? glob.slice(0, -3) : glob;
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const out = new RegExp(`^${re}${trailing ? "(?:/.*)?" : ""}$`);
  cache.set(glob, out);
  return out;
}

export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/** Literal part of a glob before the first wildcard. */
export const staticPrefix = (glob: string) => glob.split(/[*?[{]/)[0] ?? "";
