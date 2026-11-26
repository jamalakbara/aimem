import { test as base, expect, type Page } from "@playwright/test";
import { emptyNotebook, fullNotebook, remove, type Served, serve } from "./notebook.js";
import type { State } from "./states.js";

export interface Notebook extends Served {
  dir: string;
}

/** What no page of the viewer may ever do. Collected for every test, and required to stay empty. */
export interface Watched {
  /** Requests that leave the viewer. They are stopped before they reach the network. */
  outside: string[];
  /** Console errors (a blocked script or style would show here) and uncaught exceptions. */
  errors: string[];
  dialogs: string[];
  /** Requests that are not GET. */
  writes: string[];
}

const withNotebook = async (make: () => string, use: (n: Notebook) => Promise<void>) => {
  const dir = make();
  const served = await serve(dir);
  try {
    await use({ ...served, dir });
  } finally {
    await served.stop();
    remove(dir);
  }
};

export const test = base.extend<{ watched: Watched }, { full: Notebook; empty: Notebook }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a function needs from this pattern.
  full: [async ({}, use) => withNotebook(fullNotebook, use), { scope: "worker" }],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a function needs from this pattern.
  empty: [async ({}, use) => withNotebook(emptyNotebook, use), { scope: "worker" }],
  watched: [
    async ({ context }, use) => {
      const seen: Watched = { outside: [], errors: [], dialogs: [], writes: [] };
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1") return route.continue();
        seen.outside.push(url.href);
        return route.abort();
      });
      context.on("request", (r) => {
        if (r.method() !== "GET") seen.writes.push(`${r.method()} ${r.url()}`);
      });
      const watch = (page: Page) => {
        page.on("pageerror", (e) => seen.errors.push(e.message));
        page.on("console", (m) => {
          // Chromium logs every 404 document; the tests assert those statuses themselves.
          if (m.type() === "error" && !/status of 404/.test(m.text())) seen.errors.push(m.text());
        });
        page.on("dialog", (d) => {
          seen.dialogs.push(d.message());
          void d.dismiss();
        });
      };
      for (const page of context.pages()) watch(page);
      context.on("page", watch);
      await use(seen);
      expect(seen).toEqual({ outside: [], errors: [], dialogs: [], writes: [] });
    },
    { auto: true },
  ],
});

export { expect };

/** Opens a state and proves that it is the one meant. */
export async function open(page: Page, n: Notebook, s: State): Promise<void> {
  const response = await page.goto(n.origin + s.path);
  expect(response?.status(), s.path).toBe(s.status ?? 200);
  await expect(page.locator("main")).toContainText(s.has);
}

/** True when the page itself scrolls sideways. A table or a code block may scroll inside its own box. */
export const overflows = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth;
  });
