import { createVerify, generateKeyPairSync } from "node:crypto";

/** A simulated Google: token endpoint, Drive v3 and Sheets v4, as documented. Not recordings of a real account. */
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export const TOKEN = "ya29.simulated-access-token-value-000111222";
export const EMAIL = "aimem-sync@example-project.iam.gserviceaccount.com";
export const FOLDER = "1FolderInboxAAAAAAAAAAAAAAAA";
export const keyFile = () =>
  JSON.stringify({
    type: "service_account",
    client_email: EMAIL,
    private_key: PRIVATE_KEY,
    token_uri: "https://evil.example/token",
  });

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  markdown?: string;
  tabs?: { sheetId: number; title: string; hidden?: boolean; values: unknown[][] }[];
  /** Status (and reason) for the content request of this file. */
  fail?: { status: number; reason?: string };
}
export const DOC = "application/vnd.google-apps.document";
export const SHEET = "application/vnd.google-apps.spreadsheet";

export function fakeGoogle(files: FakeFile[]) {
  const state = {
    files,
    folder: { status: 200, mimeType: "application/vnd.google-apps.folder" },
    tokenStatus: 200,
    /** Consumed one per request, before anything else. */
    queue: [] as { status?: number; headers?: Record<string, string>; throw?: string; body?: string }[],
    pageSize: 100,
    loopPages: false,
    requests: [] as { url: URL; auth: string | null; method: string }[],
    scopes: [] as string[],
    jwtOk: false,
  };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  // Error bodies echo the token on purpose: nothing from a body may reach a message.
  const err = (status: number, reason = "forbidden") =>
    json({ error: { code: status, message: `bad ${TOKEN}`, errors: [{ reason, message: TOKEN }] } }, status);
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    state.requests.push({ url, auth, method: init?.method ?? "GET" });
    const q = state.queue.shift();
    if (q?.throw) throw new Error(q.throw);
    if (q?.status)
      return new Response(q.body ?? `failed ${TOKEN}`, { status: q.status, headers: q.headers ?? {} });
    if (url.href === "https://oauth2.googleapis.com/token") {
      if (state.tokenStatus !== 200) return err(state.tokenStatus, "invalid_grant");
      const [h = "", c = "", s = ""] = (new URLSearchParams(String(init?.body)).get("assertion") ?? "").split(
        ".",
      );
      state.scopes = JSON.parse(Buffer.from(c, "base64url").toString()).scope.split(" ");
      state.jwtOk = createVerify("RSA-SHA256")
        .update(`${h}.${c}`)
        .verify(pair.publicKey, Buffer.from(s, "base64url"));
      return json({ access_token: TOKEN, expires_in: 3600, token_type: "Bearer" });
    }
    if (auth !== `Bearer ${TOKEN}`) return err(401, "authError");
    const drive = /^\/drive\/v3\/files(?:\/([^/]+))?(\/export)?$/.exec(url.pathname);
    if (url.host === "www.googleapis.com" && drive) {
      const [, id, exp] = drive;
      if (!id) {
        const start = Number(url.searchParams.get("pageToken") ?? 0);
        const page = state.files.slice(start, start + state.pageSize);
        const next = start + state.pageSize < state.files.length ? String(start + state.pageSize) : undefined;
        return json({
          files: page.map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime })),
          ...(state.loopPages ? { nextPageToken: "0" } : next ? { nextPageToken: next } : {}),
        });
      }
      if (id === FOLDER)
        return state.folder.status === 200
          ? json({ id, mimeType: state.folder.mimeType })
          : err(state.folder.status, "notFound");
      const f = state.files.find((x) => x.id === id);
      if (!f) return err(404, "notFound");
      if (!exp) return json({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime });
      if (f.fail) return err(f.fail.status, f.fail.reason);
      return new Response(f.markdown ?? "", { headers: { "content-type": "text/markdown" } });
    }
    const sheet = /^\/v4\/spreadsheets\/([^/]+)(?:\/values\/(.+))?$/.exec(url.pathname);
    if (url.host === "sheets.googleapis.com" && sheet) {
      const f = state.files.find((x) => x.id === sheet[1]);
      if (!f) return err(404, "notFound");
      if (f.fail) return err(f.fail.status, f.fail.reason);
      if (!sheet[2])
        return json({
          sheets: (f.tabs ?? []).map(({ sheetId, title, hidden }) => ({
            properties: { sheetId, title, ...(hidden ? { hidden } : {}) },
          })),
        });
      const range = decodeURIComponent(sheet[2]);
      const tab = (f.tabs ?? []).find((t) => range.startsWith(`'${t.title.replaceAll("'", "''")}'!`));
      return tab ? json({ range, values: tab.values }) : err(400, "badRequest");
    }
    return err(404, "notFound");
  };
  return { state, fetch };
}

export const decisionDoc = (over: Partial<FakeFile> = {}): FakeFile => ({
  id: "1DocDecisionBBBBBBBBBBBBBBBB",
  name: "Store parcel events for 90 days",
  mimeType: DOC,
  modifiedTime: "2026-11-20T10:00:00.000Z",
  markdown:
    "# **Summary**\n\nScan events are kept for 90 days.\n\n# Status\n\nAccepted\n\n# Context\n\nEvents grow. ![][image1]\n\n# Decision\n\nKeep 90 days.\n\n# Consequences\n\nReplay is limited.\n\n[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA>\n",
  ...over,
});
export const taskSheet = (over: Partial<FakeFile> = {}): FakeFile => ({
  id: "1SheetTasksCCCCCCCCCCCCCCCCC",
  name: "Backlog",
  mimeType: SHEET,
  modifiedTime: "2026-11-20T11:00:00.000Z",
  tabs: [
    {
      sheetId: 0,
      title: "Sprint's plan",
      values: [
        ["title", "summary", "status", "due"],
        ...WORDS.map((w, i) => [`${w} ${WORDS[(i + 7) % WORDS.length]}`, `${w} job.`, "open", 46371]),
      ],
    },
    {
      sheetId: 9,
      title: "Private",
      hidden: true,
      values: [
        ["title", "status"],
        ["Hidden row", "open"],
      ],
    },
  ],
  ...over,
});
const WORDS =
  "amber bridge copper dragon ember falcon garnet harbor island jasper kernel lantern meadow nectar orchid pepper quartz ribbon saddle timber".split(
    " ",
  );
