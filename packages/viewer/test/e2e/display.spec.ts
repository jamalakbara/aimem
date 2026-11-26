import { P } from "./notebook.js";
import { EMPTY_STATES, STATES } from "./states.js";
import { expect, open, overflows, test } from "./test.js";

/** 200 % zoom, narrow reflow, reduced motion, and contrast of what is not text (24 §5.8). */

/**
 * Browser zoom shrinks the viewport in CSS pixels: 1280 × 800 at 200 % is 640 × 400 at twice the density.
 * 320 CSS pixels is the reflow width of WCAG 1.4.10.
 */
const NARROW = [
  { name: "200 % zoom of 1280 × 800", width: 640, height: 400, deviceScaleFactor: 2 },
  { name: "reflow at 320 px", width: 320, height: 640, deviceScaleFactor: 1 },
] as const;

/** Text or controls that end beyond the window, outside a box that scrolls on purpose. */
const cutOff = () => {
  const width = document.documentElement.clientWidth;
  return [...document.querySelectorAll<HTMLElement>("body *")]
    .filter((e) => {
      if (e.closest(".scroll, pre, .sr, .skip") || !e.checkVisibility()) return false;
      const box = e.getBoundingClientRect();
      return box.width > 0 && (box.right > width + 1 || box.left < -1);
    })
    .map((e) => `${e.tagName.toLowerCase()}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`)
    .slice(0, 5);
};

for (const size of NARROW)
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.deviceScaleFactor,
    });
    for (const s of STATES)
      test(s.name, async ({ page, full }) => {
        await open(page, full, s);
        for (const summary of await page.locator("summary").all()) await summary.click();
        expect(await overflows(page), "the page scrolls sideways").toBe(false);
        expect(await page.evaluate(cutOff)).toEqual([]);
        await expect(page.locator("h1")).toBeVisible();
      });
    for (const s of EMPTY_STATES)
      test(s.name, async ({ page, empty }) => {
        await open(page, empty, s);
        expect(await overflows(page)).toBe(false);
        expect(await page.evaluate(cutOff)).toEqual([]);
      });
  });

/** Elements, with their ::before and ::after, that would move or fade. */
const moving = () =>
  [...document.querySelectorAll("*")].flatMap((e) =>
    [undefined, "::before", "::after"].flatMap((part) => {
      const s = getComputedStyle(e, part);
      const lasts = (list: string) => list.split(",").some((d) => Number.parseFloat(d) > 0);
      const out: string[] = [];
      if (lasts(s.transitionDuration)) out.push("transition");
      if (s.animationName !== "none" && lasts(s.animationDuration)) out.push("animation");
      if (s.scrollBehavior === "smooth") out.push("smooth scroll");
      return out.map((what) => `${what} on ${e.tagName.toLowerCase()}.${e.getAttribute("class") ?? ""}`);
    }),
  );

test.describe("motion", () => {
  test.describe("reduced", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });
    for (const s of STATES)
      test(`nothing moves: ${s.name}`, async ({ page, full }) => {
        await open(page, full, s);
        expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
        expect(await page.evaluate(moving)).toEqual([]);
        expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      });
  });
  test.describe("not reduced", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });
    // The control: the same check does see the one transition of the viewer.
    test("the check sees the button transition", async ({ page, full }) => {
      await page.goto(`${full.origin}${P}`);
      expect((await page.evaluate(moving)).join()).toContain("transition on button.button");
    });
  });
});

/** WCAG 1.4.11: the edge that shows where to type or choose needs 3 : 1 against what is around it. */
for (const colorScheme of ["light", "dark"] as const)
  test.describe(`contrast of field edges, ${colorScheme}`, () => {
    test.use({ colorScheme });
    for (const [name, path] of [
      ["search box and filters", `${P}/search?q=zzpaged`],
      ["role lens", P],
    ] as const)
      test(name, async ({ page, full }) => {
        await page.goto(full.origin + path);
        const edges = await page.evaluate(() => {
          const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
          const light = (c: number[]) => {
            const [r = 0, g = 0, b = 0] = c.slice(0, 3).map((v) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          return [...document.querySelectorAll<HTMLElement>('input[type="search"], select')].map((e) => {
            // The edge is an inset shadow: `rgb(…) 0px 0px 0px 1px inset`.
            const edge = rgb(getComputedStyle(e).boxShadow.split(")")[0] ?? "");
            let back = [255, 255, 255];
            for (let p = e.parentElement; p; p = p.parentElement) {
              const c = rgb(getComputedStyle(p).backgroundColor);
              if (c.length === 3 || c[3] === 1) {
                back = c;
                break;
              }
            }
            const [a, b] = [light(edge), light(back)];
            return {
              field: e.id,
              found: edge.length >= 3,
              ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
            };
          });
        });
        expect(edges.length).toBeGreaterThan(0);
        test.info().annotations.push({ type: "edge contrast", description: JSON.stringify(edges) });
        expect(edges.filter((e) => !e.found || e.ratio < 3)).toEqual([]);
      });
  });
