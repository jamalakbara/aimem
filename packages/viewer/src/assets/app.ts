import { T } from "../strings.js";

/** The one script, served as a constant. Every page works without it; it adds Copy reference, the search key, and
 * the way back to the result that was opened. */
export const SCRIPT = `"use strict";
const mac = /Mac|iP/.test(navigator.platform);
addEventListener("keydown", (e) => {
  const box = document.getElementById("q");
  const key = (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;
  if (!box || !key || e.isComposing || e.key.toLowerCase() !== "k") return;
  e.preventDefault();
  box.focus();
  box.select();
});
for (const a of document.querySelectorAll('a[id^="r-"]'))
  a.addEventListener("click", () => history.replaceState(null, "", "#" + a.id));
if (location.hash.startsWith("#r-")) document.getElementById(location.hash.slice(1))?.focus();
for (const button of document.querySelectorAll("button[data-copy]")) {
  if (!navigator.clipboard) continue;
  const label = button.textContent;
  let timer;
  button.hidden = false;
  button.setAttribute("aria-live", "polite");
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    let shown = ${JSON.stringify(T.copied)};
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      shown = ${JSON.stringify(T.copyFailed)};
    }
    button.textContent = shown;
    timer = setTimeout(() => { button.textContent = label; }, 2000);
  });
}
`;
