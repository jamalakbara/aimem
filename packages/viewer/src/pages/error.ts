import { type Html, html } from "../html.js";
import { T } from "../strings.js";

export const errorPage = (status: number, message: string): Html =>
  html`<h1>${T.errors[status] ?? status}</h1><p>${message}</p><p><a href="/">${T.home}</a></p>`;
