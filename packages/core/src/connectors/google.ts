import { createSign } from "node:crypto";
import type { FetchLike } from "../embed/remote.js";
import { AimemError } from "../errors.js";
import type { IndexedRecord } from "../index/build.js";
import { documentToRecord } from "../ingest/document.js";
import { sheetToRecords } from "../ingest/sheet.js";
import type { ExternalInput } from "../ops/write.js";
import type { Clock } from "../ports.js";

/** Read-only, and nothing else (16 §5, 23 decision 4). */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];
/** Fixed, never taken from the key file: a doctored file must not send the signed request elsewhere. */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const FOLDER = "application/vnd.google-apps.folder";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_TABS = 50;
const MAX_ROWS = 5000;
const MAX_TRIES = 4;
const MAX_WAIT_MS = 30_000;
const TIMEOUT_MS = 30_000;

/** A Drive id, also inside a Drive or Docs link; `undefined` for anything else (it goes into a query). */
export function googleId(value: string): string | undefined {
  const link =
    /^https:\/\/(?:docs|drive)\.google\.com\/(?:[\w/-]*\/)?(?:d|folders)\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/.exec(
      value,
    );
  const id = link?.[1] ?? value;
  return /^[A-Za-z0-9_-]{10,100}$/.test(id) ? id : undefined;
}

export interface GoogleKey {
  clientEmail: string;
  privateKey: string;
}

/** A service-account key file. Messages never quote its content. */
export function parseGoogleKey(text: string): GoogleKey {
  let k: Record<string, unknown> | undefined;
  try {
    k = JSON.parse(text) as Record<string, unknown>;
  } catch {
    k = undefined;
  }
  if (
    k?.type !== "service_account" ||
    typeof k.client_email !== "string" ||
    !/^[\w.+-]+@[\w.-]+$/.test(k.client_email) ||
    typeof k.private_key !== "string"
  )
    throw new AimemError(
      "SOURCE_AUTH",
      "the Google key file is not a service-account key (JSON with client_email and private_key)",
    );
  return { clientEmail: k.client_email, privateKey: k.private_key };
}

/** The content of one file could not be read; the run goes on with the others. */
class FileError extends Error {}

export interface GoogleDeps {
  key: GoogleKey;
  fetch: FetchLike;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

const plain = (s: unknown) =>
  [...String(s ?? "")]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join("")
    .trim();

export class GoogleClient {
  #token: { value: string; until: number } | undefined;
  constructor(private readonly deps: GoogleDeps) {}

  #auth(what: string): AimemError {
    return new AimemError(
      "SOURCE_AUTH",
      `Google refused ${what}; check that the service account ${this.deps.key.clientEmail} still exists and that the inbox folder or file is shared with it`,
    );
  }

  /** One request with retries. Response bodies and fetch errors never reach a message: they can echo a token. */
  async #request(url: string, init: RequestInit): Promise<Response> {
    const host = new URL(url).host;
    for (let i = 1; ; i++) {
      let res: Response | undefined;
      try {
        // A redirect could carry the token to another host.
        res = await this.deps.fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        res = undefined;
      }
      if (res && res.status !== 429 && res.status < 500) return res;
      if (i >= MAX_TRIES)
        throw new AimemError(
          "SOURCE_UNREACHABLE",
          res
            ? `${host} keeps answering ${res.status}; nothing was changed, try again later`
            : `could not reach ${host}; nothing was changed, check the connection`,
        );
      await res?.body?.cancel().catch(() => undefined);
      const after = Number(res?.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** (i - 1);
      await this.deps.sleep(Math.min(wait, MAX_WAIT_MS));
    }
  }

  async #bearer(): Promise<string> {
    const now = this.deps.clock.now().getTime();
    if (this.#token && this.#token.until > now) return this.#token.value;
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const iat = Math.floor(now / 1000);
    const head = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: this.deps.key.clientEmail, scope: GOOGLE_SCOPES.join(" "), aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
    let sig: string;
    try {
      sig = createSign("RSA-SHA256").update(head).sign(this.deps.key.privateKey, "base64url");
    } catch {
      throw new AimemError("SOURCE_AUTH", "the private key in the Google key file cannot be used");
    }
    const res = await this.#request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${head}.${sig}`,
      }).toString(),
    });
    const body = res.ok
      ? ((await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown })
      : {};
    if (typeof body.access_token !== "string") throw this.#auth("the key");
    this.#token = {
      value: body.access_token,
      until: now + (Math.min(Number(body.expires_in) || 3600, 3600) - 120) * 1000,
    };
    return this.#token.value;
  }

  async #get(url: string): Promise<Response> {
    return this.#request(url, {
      method: "GET",
      headers: { authorization: `Bearer ${await this.#bearer()}` },
    });
  }

  async #text(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new AimemError(
          "SOURCE_UNREACHABLE",
          "the connection to Google broke off; nothing was changed, try again",
        );
      });
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FileError("is larger than 10 MB");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  /** Only a short machine word from an error body, e.g. `exportSizeLimitExceeded`. */
  async #reason(res: Response): Promise<string> {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: unknown }[]; status?: unknown };
    };
    const r = body.error?.errors?.[0]?.reason ?? body.error?.status;
    return typeof r === "string" && /^[A-Za-z_]{3,40}$/.test(r) ? r : String(res.status);
  }

  async #content(url: string, verb: string): Promise<string> {
    const res = await this.#get(url);
    if (res.status === 401) throw this.#auth("the access token");
    if (!res.ok) throw new FileError(`Google refused to ${verb} it (${await this.#reason(res)})`);
    return this.#text(res);
  }

  /** The folder itself is checked first: an unshared folder lists as empty, which must not look like deletions. */
  async listFolder(folderId: string): Promise<DriveFile[]> {
    const f = await this.#get(`${DRIVE}/${folderId}?fields=id,mimeType&supportsAllDrives=true`);
    if (!f.ok) throw this.#auth(`the inbox folder ${folderId}`);
    if (((await f.json()) as { mimeType?: string }).mimeType !== FOLDER)
      throw new AimemError("USAGE", `${folderId} is not a Drive folder`);
    const out: DriveFile[] = [];
    const seen = new Set<string>();
    let page: string | undefined;
    do {
      const q = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime)",
        pageSize: "100",
        orderBy: "name",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(page ? { pageToken: page } : {}),
      });
      const res = await this.#get(`${DRIVE}?${q}`);
      if (!res.ok) throw this.#auth(`the list of folder ${folderId}`);
      const body = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
        incompleteSearch?: boolean;
      };
      if (body.incompleteSearch)
        throw new AimemError(
          "SOURCE_UNREACHABLE",
          "Google returned an incomplete folder list; nothing was changed, try again",
        );
      out.push(...(body.files ?? []).filter((x) => googleId(x.id) === x.id));
      page = body.nextPageToken;
      if (page !== undefined && (seen.has(page) || seen.size > MAX_FILES))
        throw new AimemError(
          "SOURCE_UNREACHABLE",
          "Google kept returning the same page of the folder; nothing was changed",
        );
      if (page !== undefined) seen.add(page);
      if (out.length > MAX_FILES)
        throw new AimemError(
          "USAGE",
          `the inbox folder has more than ${MAX_FILES} files; use a smaller folder`,
        );
    } while (page);
    return out;
  }

  /** `undefined` when the file is gone or no longer shared. */
  async file(id: string): Promise<DriveFile | undefined> {
    const res = await this.#get(
      `${DRIVE}/${id}?fields=id,name,mimeType,modifiedTime,trashed&supportsAllDrives=true`,
    );
    if (res.status === 404) return undefined;
    if (!res.ok) throw this.#auth(`the file ${id}`);
    const f = (await res.json()) as DriveFile & { trashed?: boolean };
    return f.trashed ? undefined : f;
  }

  exportDoc(id: string): Promise<string> {
    return this.#content(`${DRIVE}/${id}/export?mimeType=text%2Fmarkdown`, "export");
  }

  async tabs(id: string): Promise<{ gid: number; title: string; hidden: boolean }[]> {
    const body = JSON.parse(
      await this.#content(`${SHEETS}/${id}?fields=sheets.properties(sheetId,title,hidden)`, "open"),
    ) as {
      sheets?: { properties?: { sheetId?: number; title?: string; hidden?: boolean } }[];
    };
    return (body.sheets ?? []).map((s) => ({
      gid: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? "",
      hidden: Boolean(s.properties?.hidden),
    }));
  }

  /** Computed values as text (never formulas); dates as serial numbers, like in xlsx. */
  async values(id: string, title: string): Promise<string[][]> {
    const range = encodeURIComponent(`'${title.replaceAll("'", "''")}'!A1:ZZ${MAX_ROWS + 2}`);
    const body = JSON.parse(
      await this.#content(
        `${SHEETS}/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
        "read",
      ),
    ) as { values?: unknown[][] };
    return (body.values ?? []).map((r) =>
      r.map((c) =>
        typeof c === "boolean" ? String(c).toUpperCase() : c === null || c === undefined ? "" : String(c),
      ),
    );
  }
}

/** Google's markdown export: image data dropped (alt text kept), bold markers around headings removed. */
export function cleanGoogleMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\[[^\]\n]+\]:\s*<?data:[^\n]*$/gm, "")
    .replace(/!\[([^\]\n]*)\](?:\[[^\]\n]*\]|\([^)\n]*\))/g, "$1")
    .replace(/^(#{1,6})\s+(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/gm, "$1 $2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface GoogleCollected {
  inputs: { file: string; where?: string; input: ExternalInput }[];
  /** Records left alone because their Doc did not change. */
  unchanged: string[];
  /** Records whose file, tab or row is gone. */
  missing: string[];
  errors: { file: string; reason: string }[];
  warnings: string[];
}

/**
 * Read everything first (16 §3 fetch, normalise, map): nothing is written here, so an auth or network
 * failure leaves the notebook as it was. Files that fail on their own are reported and kept.
 */
export async function collectGoogle(
  client: GoogleClient,
  cfg: { folder?: string; files: readonly string[] },
  records: readonly IndexedRecord[],
  author: string,
): Promise<GoogleCollected> {
  const out: GoogleCollected = { inputs: [], unchanged: [], missing: [], errors: [], warnings: [] };
  const found = new Map<string, DriveFile>();
  if (cfg.folder) for (const f of await client.listFolder(cfg.folder)) found.set(f.id, f);
  for (const id of cfg.files) {
    if (found.has(id)) continue;
    const f = await client.file(id);
    if (f) found.set(id, f);
  }
  type Src = { system?: string; id?: string; row?: unknown; version?: unknown; state?: string };
  const mine = records
    .filter((r) => !r.notebook && r.fm.managed_by === "external")
    .map((r) => ({ r, src: (r.fm.source ?? {}) as Src }))
    .filter((x) => x.src.system === "google-doc" || x.src.system === "google-sheet");
  const bySource = new Map<string, typeof mine>();
  for (const x of mine) bySource.set(String(x.src.id), [...(bySource.get(String(x.src.id)) ?? []), x]);
  for (const [id, list] of bySource)
    if (!found.has(id)) out.missing.push(...list.filter((x) => x.src.state !== "missing").map((x) => x.r.id));

  for (const f of found.values()) {
    const name = plain(f.name).slice(0, 120) || f.id;
    const known = bySource.get(f.id) ?? [];
    try {
      if (f.mimeType === DOC) {
        const rec = known[0];
        if (rec && rec.src.state === "ok" && rec.src.version === f.modifiedTime) {
          out.unchanged.push(rec.r.id);
          continue;
        }
        const text = cleanGoogleMarkdown(await client.exportDoc(f.id));
        if (!text) throw new FileError("has no text");
        // The Doc's name is the title (16 §4.2), so every heading of the text is a section.
        const doc = documentToRecord(`# ${name}\n\n${text}`, name);
        if (doc.mode === "whole-document") doc.body = text;
        out.warnings.push(...(doc.notes ?? []).map((n) => `${name}: ${n}`));
        if (doc.warning) out.warnings.push(`${name}: ${doc.warning}`);
        out.inputs.push({
          file: name,
          input: {
            type: doc.type,
            title: doc.title,
            summary: doc.summary,
            body: doc.body,
            author,
            ...(doc.status ? { status: doc.status } : {}),
            ...(doc.roles ? { roles: doc.roles } : {}),
            ...(doc.tags ? { tags: doc.tags } : {}),
            ...(doc.fields ? { fields: doc.fields } : {}),
            source: {
              system: "google-doc",
              id: f.id,
              url: `https://docs.google.com/document/d/${f.id}/edit`,
              version: f.modifiedTime,
            },
          },
        });
      } else if (f.mimeType === SHEET) await collectSheet(client, f, name, known, author, out);
      else if (f.mimeType !== FOLDER)
        out.warnings.push(
          `${name}: ${plain(f.mimeType).slice(0, 80)} files are not synced; download it and use aimem import`,
        );
    } catch (e) {
      if (!(e instanceof FileError) && !(e instanceof SyntaxError)) throw e;
      out.errors.push({
        file: name,
        reason: e instanceof FileError ? e.message : "Google sent an answer that could not be read",
      });
    }
  }
  return out;
}

async function collectSheet(
  client: GoogleClient,
  f: DriveFile,
  name: string,
  known: readonly { r: IndexedRecord; src: { row?: unknown; state?: string } }[],
  author: string,
  out: GoogleCollected,
): Promise<void> {
  const tabs = await client.tabs(f.id);
  if (tabs.length > MAX_TABS) throw new FileError(`has more than ${MAX_TABS} tabs`);
  const inputs: GoogleCollected["inputs"] = [];
  /** Tabs read completely: only their absent rows are gone. Tabs of records that are not listed are gone too. */
  const complete = new Set<number>();
  const present = new Set<string>();
  for (const t of tabs) {
    const title = plain(t.title);
    if (t.hidden) {
      out.warnings.push(`${name}: hidden tab '${title}' was skipped`);
      continue;
    }
    const rows = await client.values(f.id, t.title);
    if (!rows.length) {
      complete.add(t.gid);
      continue;
    }
    if (rows.length > MAX_ROWS + 1) {
      out.errors.push({ file: name, reason: `tab '${title}' has more than ${MAX_ROWS} rows` });
      continue;
    }
    let sheet: ReturnType<typeof sheetToRecords>;
    try {
      sheet = sheetToRecords(rows, `${name} / ${title}`, undefined, { padShortRows: true });
    } catch {
      out.warnings.push(`${name}: tab '${title}' matches no sheet template and was skipped`);
      continue;
    }
    out.warnings.push(...sheet.notes.map((n) => `${name} / ${title} row ${n.row}: ${n.reason}`));
    out.errors.push(
      ...sheet.errors.map((e) => ({ file: name, reason: `${title} row ${e.row}: ${e.reason}` })),
    );
    if (!sheet.errors.length) complete.add(t.gid);
    for (const { row, key, record } of sheet.items) {
      const id = `${t.gid}!${key !== undefined ? `key:${key}` : row}`;
      present.add(id);
      inputs.push({
        file: name,
        where: `${title} row ${row}`,
        input: {
          type: record.type,
          title: record.title,
          summary: record.summary,
          body: record.body,
          author,
          ...(record.status ? { status: record.status } : {}),
          ...(record.roles ? { roles: record.roles } : {}),
          ...(record.tags ? { tags: record.tags } : {}),
          fields: { ...record.fields, ...(record.paths ? { paths: record.paths } : {}) },
          source: {
            system: "google-sheet",
            id: f.id,
            url: `https://docs.google.com/spreadsheets/d/${f.id}/edit#gid=${t.gid}`,
            row: id,
            version: f.modifiedTime,
          },
        },
      });
    }
  }
  out.inputs.push(...inputs);
  const listed = new Set(tabs.map((t) => t.gid));
  for (const { r, src } of known) {
    const gid = Number(String(src.row).split("!")[0]);
    if (src.state === "missing" || present.has(String(src.row))) continue;
    if (complete.has(gid) || !listed.has(gid)) out.missing.push(r.id);
  }
}
