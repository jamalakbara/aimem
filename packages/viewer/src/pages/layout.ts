import { type Html, html } from "../html.js";

export function layout(title: string, body: Html): string {
  return String(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/assets/style.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`);
}
