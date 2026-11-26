import type { Page } from "@playwright/test";
import { IDS, listed, P } from "./notebook.js";
import { EMPTY_STATES, STATES } from "./states.js";
import { expect, type Notebook, open, test } from "./test.js";

/** Keyboard only: order, a focus that can be seen, no trap, and the flows a reader needs (24 §5.8). */

interface Stop {
  key: number;
  what: string;
  /** Contrast of the focus ring against what is behind it; WCAG 1.4.11 asks for 3. */
  ratio: number;
  ring: string;
  width: number;
  inView: boolean;
  /** Something else is drawn over the middle of the focused element. */
  covered: boolean;
}

/** Marks every element that Tab should reach, in document order, and returns how many there are. */
const mark = (page: Page) =>
  page.evaluate(() => {
    const all = [
      ...document.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,summary,[tabindex]"),
    ].filter(
      (e) =>
        e.getAttribute("tabindex") !== "-1" &&
        e.checkVisibility({ visibilityProperty: true }) &&
        !(e as HTMLButtonElement).disabled,
    );
    all.forEach((e, i) => {
      e.dataset.stop = String(i);
    });
    return { count: all.length, positive: all.filter((e) => e.tabIndex > 0).length };
  });

const focused = (page: Page): Promise<Stop | null> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return null;
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const light = (c: number[]) => {
      const [r = 0, g = 0, b = 0] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The ring is drawn outside the element, so it is seen against the first painted ancestor.
    let back = [255, 255, 255];
    for (let p = e.parentElement; p; p = p.parentElement) {
      const c = rgb(getComputedStyle(p).backgroundColor);
      if (c.length === 3 || c[3] === 1) {
        back = c;
        break;
      }
    }
    // The skip link floats over the header, on its own background.
    if (e.classList.contains("skip")) back = rgb(getComputedStyle(e).backgroundColor);
    const style = getComputedStyle(e);
    const [a, b] = [light(rgb(style.outlineColor)), light(back)];
    const box = e.getClientRects()[0] ?? e.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + Math.min(box.width, innerWidth) / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    return {
      key: Number(e.dataset.stop ?? -1),
      what: `${e.tagName.toLowerCase()} ${(e.getAttribute("aria-label") ?? e.innerText ?? "").trim().slice(0, 40)}`,
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ring: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      inView: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
      covered: !(top && (e === top || e.contains(top) || top.contains(e))),
    };
  });

/** Tabs through the whole page and back round, and reports everything that is wrong on the way. */
async function walk(page: Page): Promise<{ count: number; wrong: string[] }> {
  const { count, positive } = await mark(page);
  const wrong: string[] = positive ? [`${positive} elements with a positive tabindex`] : [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Tab");
    const s = await focused(page);
    if (!s) {
      wrong.push(`focus left the page after ${i} of ${count}`);
      break;
    }
    if (s.key !== i) wrong.push(`stop ${i} went to ${s.key} (${s.what})`);
    if (s.ring === "none" || s.width < 2) wrong.push(`no visible ring on ${s.what}: ${s.ring} ${s.width}px`);
    else if (s.ratio < 3) wrong.push(`ring contrast ${s.ratio.toFixed(2)} on ${s.what}`);
    if (!s.inView) wrong.push(`out of view: ${s.what}`);
    if (s.covered) wrong.push(`covered by something else: ${s.what}`);
  }
  // After the last element, Tab leaves the page (to the browser) and then starts again: no trap.
  let again: Stop | null = null;
  for (let i = 0; i < 3 && again?.key !== 0; i++) {
    await page.keyboard.press("Tab");
    again = await focused(page);
  }
  if (again?.key !== 0)
    wrong.push(`Tab did not come round to the first element (${again?.what ?? "nothing"})`);
  return { count, wrong };
}

const LOOKS = [
  { name: "desktop, light", width: 1280, height: 800, colorScheme: "light" },
  { name: "desktop, dark", width: 1280, height: 800, colorScheme: "dark" },
  { name: "phone, light", width: 390, height: 844, colorScheme: "light" },
  { name: "200 % zoom, light", width: 640, height: 400, colorScheme: "light" },
] as const;

for (const look of LOOKS)
  test.describe(`Tab through every page: ${look.name}`, () => {
    test.use({ viewport: { width: look.width, height: look.height }, colorScheme: look.colorScheme });
    for (const s of STATES)
      test(s.name, async ({ page, full }) => {
        await open(page, full, s);
        const { count, wrong } = await walk(page);
        expect(count).toBeGreaterThan(0);
        expect(wrong).toEqual([]);
      });
    for (const s of EMPTY_STATES)
      test(s.name, async ({ page, empty }) => {
        await open(page, empty, s);
        expect((await walk(page)).wrong).toEqual([]);
      });
  });

/** Presses Tab until the element has the focus; fails when it cannot be reached. */
async function tabTo(page: Page, selector: string, max = 200) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
  }
  throw new Error(`Tab never reached ${selector}`);
}

const activeIs = (page: Page, selector: string) =>
  expect
    .poll(() => page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector), {
      message: `focus on ${selector}`,
    })
    .toBe(true);

const at = (page: Page, n: Notebook, path: string) => page.goto(n.origin + path);

test.describe("keyboard flows", () => {
  test("the skip link is first, shows itself, and moves past the header", async ({ page, full }) => {
    await at(page, full, `${P}/r/${IDS.rich}`);
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).not.toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Enter");
    await activeIs(page, "main#main");
    await page.keyboard.press("Tab");
    await activeIs(page, "main#main :focus, main#main a, main#main button, main#main summary");
  });

  test("find a decision, read why, and come back to the same result", async ({ page, full }) => {
    await at(page, full, P);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("searchbox")).toBeFocused();
    await page.keyboard.type("Zod");
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toContainText("for “Zod”");
    await tabTo(page, "ol.results li:nth-child(2) h2 a");
    const link = page.locator("ol.results li:nth-child(2) h2 a");
    const [title, id] = [await link.innerText(), await link.getAttribute("id")];
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toHaveText(title);
    await expect(page.locator(".prose")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`q=Zod.*#${id}$`));
    await expect(page.getByRole("searchbox")).toHaveValue("Zod");
    await activeIs(page, `#${id}`);
  });

  test("Ctrl+K selects what is in the box, so typing replaces it", async ({ page, full }) => {
    await at(page, full, `${P}/search?q=ledger`);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("claim");
    await expect(page.getByRole("searchbox")).toHaveValue("claim");
  });

  test("set search filters and apply them", async ({ page, full }) => {
    await at(page, full, `${P}/search?q=zzpaged`);
    await tabTo(page, "#f-type");
    // A closed select takes the first letters of a choice.
    await page.keyboard.type("Task");
    await expect(page.locator("#f-type")).toHaveValue("task");
    await tabTo(page, "#f-closed");
    await page.keyboard.press("Space");
    await expect(page.locator("#f-closed")).toBeChecked();
    await tabTo(page, ".filters button");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/type=task/);
    await expect(page).toHaveURL(/closed=1/);
    await expect(page.locator("#f-type")).toHaveValue("task");
    await expect(page.locator("#f-closed")).toBeChecked();
  });

  test("go to the next page and back", async ({ page, full }) => {
    await at(page, full, `${P}/search?q=zzpaged`);
    await tabTo(page, "a[rel=next]");
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toContainText("Showing 26–28 of 28");
    await tabTo(page, "a[rel=prev]");
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toContainText("Showing 1–25 of 28");
  });

  test("from the dashboard to the tasks that QA reviews", async ({ page, full }) => {
    await at(page, full, P);
    await tabTo(page, 'a[href$="/tasks?status=review"]');
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toHaveText("Tasks in review");
    // The same tasks as the command line lists.
    const refs = await page
      .locator("ol.results > li")
      .evaluateAll((li) => li.map((e) => e.getAttribute("data-ref")));
    expect(refs.sort()).toEqual(listed(full.dir, "task", "review"));
    await tabTo(page, `#r-${IDS.review}`);
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toHaveText("Task waiting for review");
  });

  test("pick a role lens, keep it between pages, and take it off", async ({ page, full }) => {
    await at(page, full, P);
    await tabTo(page, "#lens");
    await page.keyboard.type("qa");
    await expect(page.locator("#lens")).toHaveValue("qa");
    await page.keyboard.press("Tab");
    await activeIs(page, "form.lens button");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/lens=qa/);
    await at(page, full, `${P}?lens=qa`);
    await tabTo(page, 'nav[aria-label="Sections"] a[href*="/tasks"]');
    await page.keyboard.press("Enter");
    await expect(page.locator("p.lens")).toContainText("Role: qa");
    await tabTo(page, "p.lens a");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${full.origin}${P}/tasks`);
    await expect(page.locator("p.lens")).toHaveCount(0);
  });

  test("open the header sections and a status chip", async ({ page, full }) => {
    await at(page, full, P);
    for (const [part, heading] of [
      ["/decisions", "Decisions"],
      ["/handoffs", "Handoffs"],
      ["/records", "Browse by type"],
      ["/tasks", "Tasks"],
    ]) {
      await tabTo(page, `nav[aria-label="Sections"] a[href$="${part}"]`);
      await page.keyboard.press("Enter");
      await expect(page.locator("h1")).toHaveText(heading as string);
    }
    await tabTo(page, 'nav[aria-label="Status"] a[href$="status=blocked"]');
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toHaveText("Blocked tasks");
  });

  test("open and close the list of files that are not shown", async ({ page, full }) => {
    await at(page, full, P);
    const details = page.locator("aside details");
    await tabTo(page, "aside summary");
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("mem-broken00");
    await page.keyboard.press("Space");
    await expect(details).not.toHaveAttribute("open", "");
  });

  for (const [what, selector] of [
    ["a wide table", ".prose .scroll"],
    ["a long code block", ".prose pre"],
  ] as const)
    test(`scroll ${what} with the arrow keys`, async ({ page, full }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await at(page, full, `${P}/r/${IDS.rich}`);
      const box = page.locator(selector).first();
      expect(await box.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
      await tabTo(page, selector);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => box.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    });

  test("switch between formatted and plain text", async ({ page, full }) => {
    await at(page, full, `${P}/r/${IDS.rich}`);
    await tabTo(page, 'a[href="?view=plain"]');
    await page.keyboard.press("Enter");
    await expect(page.locator("pre.plain")).toContainText("## Wide table");
    await tabTo(page, 'a[href="?"]');
    await page.keyboard.press("Enter");
    await expect(page.locator(".prose")).toBeVisible();
  });

  test("copy a reference, and hear what happened", async ({ page, context, full }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: full.origin });
    await at(page, full, `${P}/r/${IDS.rich}`);
    await tabTo(page, "button[data-copy]");
    const button = page.locator("button[data-copy]");
    await expect(button).toHaveAttribute("aria-live", "polite");
    await page.keyboard.press("Enter");
    await expect(button).toHaveText("Copied");
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(IDS.rich);
    await expect(button).toHaveText("Copy reference", { timeout: 5000 });
  });

  test("say in words when copying fails", async ({ page, full }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("no")) },
      });
    });
    await at(page, full, `${P}/r/${IDS.rich}`);
    await tabTo(page, "button[data-copy]");
    await page.keyboard.press("Space");
    await expect(page.locator("button[data-copy]")).toHaveText("Copy failed");
  });
});

test.describe("without the script", () => {
  test.use({ javaScriptEnabled: false });
  test("search, filters and the lens still work, and no dead button is shown", async ({ page, full }) => {
    await at(page, full, P);
    await page.getByRole("searchbox").fill("zzpaged");
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toContainText("28 results");
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("memory");
    await page.getByRole("button", { name: "Apply filters" }).press("Enter");
    await expect(page.locator("main")).toContainText("No matching records");
    await at(page, full, P);
    await page.locator("#lens").selectOption("qa");
    await page.getByRole("button", { name: "Apply", exact: true }).press("Enter");
    await expect(page).toHaveURL(/lens=qa/);
    await at(page, full, `${P}/r/${IDS.rich}`);
    await expect(page.locator("button[data-copy]")).toBeHidden();
  });
});
