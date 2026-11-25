import { T } from "../strings.js";

/** The one script, served as a constant. Every page works without it; it adds Copy reference. */
export const SCRIPT = `"use strict";
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
