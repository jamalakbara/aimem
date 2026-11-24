import { type Html, html } from "../html.js";
import { T } from "../strings.js";

/** It says nothing about the request, so a hostile address never reaches the page. */
export const errorPage = (status: number, message: string): Html =>
  html`<div class="empty"><h1>${T.errors[status] ?? status}</h1><p>${message}</p><p><a class="button" href="/">${T.home}</a></p></div>`;
