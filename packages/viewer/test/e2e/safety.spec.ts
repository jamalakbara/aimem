import type { Page } from "@playwright/test";
import { ALLOWED_ATTRS, ALLOWED_TAGS } from "../../src/markdown.js";
import { EVIL, HOSTILE_BODY, IDS, P, treeHash } from "./notebook.js";
import { expect, type Notebook, test } from "./test.js";

/**
 * Markdown and read-only behaviour as a real browser sees them (24 §5.8). The Vitest corpus checks the HTML the
 * viewer writes; this checks the document the browser builds from it. `watched` (test.ts) fails any test in
 * which a page asks another host, logs an error, opens a dialog or sends anything but GET.
 */

/** Everything in a rendered body that is not on the allow-lists. */
function unsafeInProse(page: Page) {
  return page.evaluate(
    ({ tags, attrs }) => {
      const out: string[] = [];
      for (const e of document.querySelectorAll(".prose *")) {
        const tag = e.tagName.toLowerCase();
        if (!tags.includes(tag)) out.push(`tag ${tag}`);
        for (const a of e.attributes)
          if (!(attrs[tag] ?? []).includes(a.name)) out.push(`attribute ${a.name} on ${tag}`);
      }
      return out;
    },
    { tags: [...ALLOWED_TAGS], attrs: ALLOWED_ATTRS as Record<string, string[]> },
  );
}

/** Everything anywhere in a document that could run, load or send something. */
function unsafeInPage(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const bad =
      "iframe,frame,svg,math,img,object,embed,base,style,video,audio,source,meta[http-equiv],template";
    for (const e of document.querySelectorAll(bad)) out.push(`element ${e.tagName.toLowerCase()}`);
    for (const s of document.querySelectorAll("script"))
      if (s.getAttribute("src") !== "/assets/app.js" || s.textContent?.trim()) out.push("another script");
    for (const l of document.querySelectorAll("link"))
      if (l.getAttribute("href") !== "/assets/style.css") out.push("another link element");
    for (const e of document.querySelectorAll("*"))
      for (const a of e.attributes)
        if (a.name.startsWith("on") || ["style", "srcdoc", "formaction", "ping", "download"].includes(a.name))
          out.push(`attribute ${a.name} on ${e.tagName.toLowerCase()}`);
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (!["http:", "https:", "mailto:"].includes(a.protocol)) out.push(`link ${a.protocol}`);
      const away = a.protocol !== "mailto:" && a.origin !== location.origin;
      if (a.username || a.password) out.push("link with credentials");
      if (away && !/\bnoopener\b.*\bnoreferrer\b/.test(a.rel)) out.push(`no rel on ${a.href}`);
    }
    for (const f of document.querySelectorAll("form")) {
      if (f.method !== "get") out.push(`form method ${f.method}`);
      if (new URL(f.action).origin !== location.origin) out.push(`form to ${f.action}`);
    }
    for (const e of document.querySelectorAll(
      'input[type="file"],input[type="password"],textarea,[contenteditable]',
    ))
      out.push(`a field to write in: ${e.tagName.toLowerCase()}`);
    return out;
  });
}

const ran = (page: Page) => page.evaluate(() => (window as { __pwned?: unknown }).__pwned ?? null);

test.describe("hostile records in the browser", () => {
  for (const [name, path] of [
    ["the record", `${P}/r/${IDS.hostile}`],
    ["the record as plain text", `${P}/r/${IDS.hostile}?view=plain`],
    ["search results", `${P}/search?q=zzhostile`],
    ["a list", `${P}/records?type=memory`],
    ["a hostile query", `${P}/search?${new URLSearchParams({ q: EVIL })}`],
    ["a hostile lens and filter", `${P}/tasks?${new URLSearchParams({ lens: EVIL, status: EVIL })}`],
    ["a hostile reference", `${P}/r/${encodeURIComponent(EVIL)}`],
    ["an unsafe source address", `${P}/r/${IDS.badUrl}`],
  ] as const)
    test(`nothing runs, loads or links unsafely: ${name}`, async ({ page, full }) => {
      await page.goto(full.origin + path);
      await page.waitForLoadState("networkidle");
      // A meta refresh or a delayed handler would act now.
      await page.waitForTimeout(500);
      expect(new URL(page.url()).origin).toBe(full.origin);
      expect(await ran(page)).toBeNull();
      expect(await unsafeInPage(page)).toEqual([]);
      expect(await unsafeInProse(page)).toEqual([]);
    });

  test("the hostile text is still there to read, as text", async ({ page, full }) => {
    await page.goto(`${full.origin}${P}/r/${IDS.hostile}`);
    const prose = page.locator(".prose");
    for (const part of ["<script>window.__pwned = 1; alert(1)</script>", "js link", "Image: remote image"])
      await expect(prose).toContainText(part);
    await expect(page.locator("h1")).toContainText(EVIL);
    // Only these three lines of the corpus become web links (the remote image as a text link); never opened.
    expect(
      await prose
        .locator('a[href^="http"]')
        .evaluateAll((a) => a.map((x) => new URL((x as HTMLAnchorElement).href).host).sort()),
    ).toEqual(["evil.example", "ok.example", "ok.example"]);
    // Bidi override characters, which can reorder what a reader sees, are removed.
    expect(await prose.innerText()).not.toContain("‮");
    await page.goto(`${full.origin}${P}/r/${IDS.hostile}?view=plain`);
    await expect(page.locator("pre.plain")).toHaveText(`${HOSTILE_BODY.replace("‮", "")}`, {
      useInnerText: true,
    });
  });

  test("an unsafe source address never becomes Edit at source", async ({ page, full }) => {
    await page.goto(`${full.origin}${P}/r/${IDS.badUrl}`);
    await expect(page.getByRole("link", { name: "Edit at source" })).toHaveCount(0);
    await page.goto(`${full.origin}${P}/r/${IDS.upload}`);
    await expect(page.getByRole("link", { name: "Edit at source" })).toHaveCount(0);
    await page.goto(`${full.origin}${P}/r/${IDS.doc}`);
    const link = page.getByRole("link", { name: "Edit at source" });
    await expect(link).toHaveAttribute("href", "https://docs.google.com/document/d/made-up/edit");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.locator("main")).toContainText("Opens docs.google.com");
  });

  // The control: the checks above do find what they look for.
  test("the checks see unsafe markup when it is there", async ({ page, full, watched }) => {
    await page.goto(`${full.origin}${P}/r/${IDS.rich}`);
    await page.evaluate(() => {
      const prose = document.querySelector(".prose") as HTMLElement;
      prose.insertAdjacentHTML(
        "beforeend",
        '<iframe></iframe><a href="javascript:void 0">x</a><a href="https://other.example/">y</a><p onclick="1" style="color:red">z</p><form method="post"></form><textarea></textarea>',
      );
    });
    const inPage = (await unsafeInPage(page)).join("\n");
    for (const part of [
      "element iframe",
      "link javascript:",
      "no rel",
      "attribute onclick",
      "attribute style",
      "form method post",
      "a field to write in",
    ])
      expect(inPage).toContain(part);
    expect((await unsafeInProse(page)).join("\n")).toContain("tag iframe");
    // The CSP refuses the inline handler and style that were just added; that is expected in this test only.
    await expect.poll(() => watched.errors.length).toBeGreaterThan(0);
    expect(watched.errors.every((e) => e.includes("Content Security Policy"))).toBe(true);
    watched.errors.length = 0;
  });

  test("rich Markdown renders as structure", async ({ page, full }) => {
    await page.goto(`${full.origin}${P}/r/${IDS.rich}`);
    expect(await unsafeInPage(page)).toEqual([]);
    expect(await unsafeInProse(page)).toEqual([]);
    const prose = page.locator(".prose");
    await expect(prose.locator("h2").first()).toHaveText("Rich text");
    await expect(prose.locator("th[scope=col]")).toHaveCount(7);
    await expect(prose.locator('ol[start="3"] > li')).toHaveCount(2);
    for (const tag of ["em", "strong", "s", "blockquote", "hr", "pre code"])
      await expect(prose.locator(tag).first()).toBeAttached();
    await expect(prose.getByRole("link", { name: "external link" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    await expect(prose.getByRole("link", { name: "mail link" })).toHaveAttribute(
      "href",
      "mailto:team@example.com",
    );
    await prose.getByRole("link", { name: "dec-1wwcakek" }).click();
    await expect(page).toHaveURL(`${full.origin}${P}/r/dec-1wwcakek`);
  });
});

/** The CSP is the second layer: the browser itself refuses what the page should never contain. */
test("the browser blocks inline script, other hosts and background requests", async ({
  page,
  full,
  watched,
}) => {
  await page.goto(`${full.origin}${P}`);
  const blocked = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) => seen.push(e.effectiveDirective));
    const script = document.createElement("script");
    script.textContent = "window.__pwned = 1";
    document.body.append(script);
    const image = new Image();
    image.src = "https://evil.example/pixel.png";
    document.body.append(image);
    const refused = await fetch(location.href).then(
      () => "sent",
      () => "refused",
    );
    await new Promise((done) => setTimeout(done, 300));
    return { seen: [...new Set(seen)].sort(), refused };
  });
  expect(blocked).toEqual({ seen: ["connect-src", "img-src", "script-src-elem"], refused: "refused" });
  expect(await ran(page)).toBeNull();
  // Those three refusals are logged; they are the point of this test, so they are cleared.
  expect(watched.errors.every((e) => e.includes("Content Security Policy"))).toBe(true);
  watched.errors.length = 0;
});

/** Every address of the viewer that can be reached by following links from the dashboard. */
async function crawl(page: Page, n: Notebook, visit: (path: string, status: number) => Promise<void>) {
  const waiting = [P];
  const known = new Set(waiting);
  for (let path = waiting.shift(); path !== undefined; path = waiting.shift()) {
    const response = await page.goto(n.origin + path);
    await visit(path, response?.status() ?? 0);
    const links = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .filter((a) => a.origin === location.origin)
        .map((a) => a.pathname + a.search),
    );
    for (const next of links)
      if (!known.has(next)) {
        known.add(next);
        waiting.push(next);
      }
  }
  return known.size;
}

test("following every link only reads: the notebook is untouched", async ({ page, full }) => {
  test.setTimeout(600_000);
  const before = treeHash(full.dir);
  const wrong: string[] = [];
  const pages = await crawl(page, full, async (path, status) => {
    if (status !== 200) wrong.push(`${status} ${path}`);
    for (const w of await unsafeInPage(page)) wrong.push(`${w} on ${path}`);
    for (const w of await unsafeInProse(page)) wrong.push(`${w} on ${path}`);
    if ((await page.locator("h1").count()) !== 1) wrong.push(`not one h1 on ${path}`);
    if ((await ran(page)) !== null) wrong.push(`script ran on ${path}`);
  });
  test.info().annotations.push({ type: "pages crawled", description: String(pages) });
  console.log(`crawled ${pages} pages`);
  expect(pages).toBeGreaterThan(100);
  expect(wrong).toEqual([]);

  // Using the forms and the one button that has a script changes nothing either.
  await page.goto(`${full.origin}${P}`);
  await page.locator("#lens").selectOption("qa");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("searchbox").fill("ledger");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters" }).click();
  // Writing methods are refused, also when the request comes from outside a page.
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    for (const path of [P, `${P}/r/${IDS.rich}`, `${P}/import`, "/assets/app.js"]) {
      const r = await page.request.fetch(full.origin + path, { method });
      expect(r.status(), `${method} ${path}`).toBe(405);
      expect(r.headers().allow).toBe("GET, HEAD");
    }
  expect(treeHash(full.dir)).toEqual(before);
});
