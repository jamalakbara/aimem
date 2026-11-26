import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { EMPTY_STATES, STATES, type State } from "./states.js";
import { expect, type Notebook, open, overflows, test } from "./test.js";

/** axe on every page type and state, in light and dark, on a desktop and a phone width (24 §5.8, 10 §7). */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** One scan for both: the WCAG rules must pass; the best-practice rules are not part of AA and are only reported. */
async function scan(page: Page) {
  const result = await new AxeBuilder({ page }).withTags([...WCAG, "best-practice"]).analyze();
  // Rule, impact and the first elements: enough to find the cause from a failed run.
  const line = (v: (typeof result.violations)[number]) =>
    `${v.id} (${v.impact}) on ${v.nodes.length}: ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ")}`;
  const isWcag = (v: { tags: string[] }) => v.tags.some((t) => WCAG.includes(t));
  return {
    wcag: result.violations.filter(isWcag).map(line),
    advice: result.violations.filter((v) => !isWcag(v)).map(line),
    // What axe could not decide by itself, such as contrast over an unknown background.
    undecided: result.incomplete.filter(isWcag).map(line),
    passed: result.passes.map((v) => v.id),
  };
}

async function check(page: Page, n: Notebook, s: State) {
  await open(page, n, s);
  // What is folded away is checked too.
  for (const summary of await page.locator("summary").all()) await summary.click();
  expect.soft(await overflows(page), "the page scrolls sideways").toBe(false);
  const found = await scan(page);
  expect.soft(found.wcag, "WCAG 2.1 A and AA").toEqual([]);
  let undecided = found.undecided;
  // axe cannot judge text that a scrolling table cuts off. The boxes are opened, the window made wide enough to
  // hold the whole table (its colours do not depend on the width), and the same rule runs again.
  const size = page.viewportSize();
  if (undecided.length > 0 && (await page.locator(".prose .scroll").count()) > 0) {
    await page.setViewportSize({ width: 3000, height: 1200 });
    await page.evaluate(() => {
      (document.querySelector("main") as HTMLElement).style.maxWidth = "none";
      for (const box of document.querySelectorAll<HTMLElement>(".prose .scroll"))
        box.style.overflow = "visible";
    });
    const again = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect.soft(again.violations, "contrast of the whole table").toEqual([]);
    undecided = [
      ...undecided.filter((u) => !u.startsWith("color-contrast ")),
      ...again.incomplete.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`)),
    ];
    if (size) await page.setViewportSize(size);
  }
  expect.soft(undecided, "WCAG checks that axe could not decide").toEqual([]);
  // Guards against a scan that silently looked at nothing.
  expect.soft(found.passed, "the contrast rule ran").toContain("color-contrast");
  for (const description of found.advice)
    test.info().annotations.push({ type: "best-practice", description });
}

for (const size of SIZES)
  for (const colorScheme of ["light", "dark"] as const)
    test.describe(`axe: ${size.name}, ${colorScheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme });
      for (const s of STATES) test(s.name, async ({ page, full }) => check(page, full, s));
      for (const s of EMPTY_STATES) test(s.name, async ({ page, empty }) => check(page, empty, s));
    });

/** Structure and labels that axe does not require: one title per page, and no state told by colour alone. */
test.describe("names and labels", () => {
  for (const s of STATES)
    test(s.name, async ({ page, full }) => {
      await open(page, full, s);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page).toHaveTitle(/\S.* · aimem$/);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(1);
      const wrong = await page.evaluate(() => {
        const out: string[] = [];
        const text = (e: Element) => (e as HTMLElement).innerText.trim();
        let level = 0;
        for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
          const next = Number(h.tagName[1]);
          if (next > level + 1) out.push(`heading level jumps from ${level} to ${next}: ${text(h)}`);
          level = next;
        }
        // Every badge says its meaning in words; the colour only repeats it.
        for (const b of document.querySelectorAll(".badge")) if (!text(b)) out.push("a badge without text");
        // Every card of a list says in words how far its record can be trusted.
        for (const card of document.querySelectorAll("li[data-ref]"))
          if (!/(^|\n| )(Verified|Not verified)/.test(text(card)))
            out.push(`no trust in words on ${card.getAttribute("data-ref")}`);
        for (const article of document.querySelectorAll("article:has(ul.badges)"))
          if (!/Verified|Not verified/.test(text(article.querySelector("ul.badges") as Element)))
            out.push("no trust in words on the record page");
        const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
        for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`id twice: ${id}`);
        return out;
      });
      expect(wrong).toEqual([]);
    });

  test("every control has a name", async ({ page, full }) => {
    await open(page, full, STATES.find((s) => s.name === "search results, page 1") as State);
    await expect(page.getByRole("searchbox", { name: "Search records" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    for (const name of ["Type", "Status", "Verification", "Role"])
      await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Include closed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
    await expect(page.getByRole("search")).toHaveCount(1);
  });

  test("the open section and the chosen filter are marked, not only coloured", async ({ page, full }) => {
    const nav = () => page.getByRole("navigation", { name: "Sections" }).locator("[aria-current=page]");
    for (const [path, name] of [
      ["tasks", "Tasks"],
      ["decisions", "Decisions"],
      ["handoffs", "Handoffs"],
      ["records?type=incident", "Browse"],
    ]) {
      await page.goto(`${full.origin}/p/aimem/${path}`);
      await expect(nav()).toHaveText(name as string);
    }
    await page.goto(`${full.origin}/p/aimem/tasks?status=review`);
    await expect(page.getByRole("navigation", { name: "Status" }).locator("[aria-current=true]")).toHaveText(
      /^In review \(\d+\)$/,
    );
  });
});
