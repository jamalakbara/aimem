export interface Target {
  /** Decoded path segments: `/p/acme/` → `["p", "acme"]`. */
  segments: string[];
  query: URLSearchParams;
}
export type Verdict = { ok: true; target: Target } | { ok: false; status: number; message: string };

const MAX_URL = 2048;
/**
 * Control characters never belong in an address of this site (headers, log lines, NUL in names). One exception:
 * an encoded tab in the query, because it can be pasted into the search box and browsers keep it there.
 */
const CONTROL = /\p{Cc}/u;

/**
 * Decides whether a request may be answered at all (24 §5.1). The viewer has no login, so this is what keeps
 * other web sites (DNS rebinding, background requests, frames) from reading or driving it.
 */
export function checkRequest(
  req: { method?: string | undefined; url?: string | undefined; rawHeaders: readonly string[] },
  port: number,
): Verdict {
  const no = (status: number, message: string): Verdict => ({ ok: false, status, message });
  const header = (name: string) =>
    req.rawHeaders.filter((_, i) => i % 2 === 1 && req.rawHeaders[i - 1]?.toLowerCase() === name);

  // Counted in the raw headers: node keeps only the first of two Host headers.
  const hosts = header("host");
  const names = ["localhost", "127.0.0.1"];
  const allowed = [...names.map((n) => `${n}:${port}`), ...(port === 80 ? names : [])];
  if (hosts.length !== 1 || !allowed.includes((hosts[0] ?? "").toLowerCase()))
    return no(421, "Open this viewer by the address it printed.");

  const url = req.url ?? "";
  if (url.length > MAX_URL) return no(414, "The address is too long.");
  if (!url.startsWith("/") || url.startsWith("//") || CONTROL.test(url))
    return no(400, "The address is not valid.");
  const cut = url.indexOf("?");
  const path = cut < 0 ? url : url.slice(0, cut);
  const search = cut < 0 ? "" : url.slice(cut + 1);
  let segments: string[];
  try {
    segments = path.split("/").slice(1).map(decodeURIComponent);
    const query = decodeURIComponent(search.replaceAll("+", " ")).replaceAll("\t", " ");
    if (CONTROL.test(segments.join("")) || CONTROL.test(query)) return no(400, "The address is not valid.");
  } catch {
    return no(400, "The address is not valid.");
  }
  if (segments.at(-1) === "") segments.pop();

  if (req.method !== "GET" && req.method !== "HEAD") return no(405, "The viewer is read-only.");

  // Browsers say who asks. Another site may link here, but not load pages in the background or in a frame.
  const site = header("sec-fetch-site");
  if (site.length && !(site.length === 1 && ["none", "same-origin"].includes(site[0] ?? ""))) {
    const navigates = header("sec-fetch-mode").join() === "navigate";
    const known = site.every((s) => s === "cross-site" || s === "same-site");
    if (!known || !navigates || header("sec-fetch-dest").join() !== "document")
      return no(403, "Another site may not load this page.");
  }
  return { ok: true, target: { segments, query: new URLSearchParams(search) } };
}
