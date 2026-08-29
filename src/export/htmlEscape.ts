// Shared HTML escape + URL-attr escape primitives.
//
// v7-tech-debt MED-1/MED-2: four near-identical `attrEsc` / `htmlEscape` /
// `escapeHtmlText` bodies and two `mdUrl` / `urlEsc` bodies were drifting
// across `markdown.ts`, `html.ts`, `pipeline.ts` and `titleHtml.ts`. The
// next sprint to add a renderer would either (a) introduce a fifth copy or
// (b) pick "the wrong one" from the four candidates. Consolidating into a
// single module eliminates the drift by construction.
//
// CONTRACT:
//  - `escapeHtmlText` escapes `& < > " '` to entities, in that order. Suitable
//    for both text content AND attribute values (covers `alt="…"`,
//    `title="…"`, etc.).
//  - `mdUrl` escapes ` ( ) < > " \`` to `%HH`. Suitable for URLs that land
//    in markdown link `(…)` or HTML attributes like `href="…"`. `?` `#` `&`
//    `'` are intentionally left as-is — they're legitimate in URLs and
//    encoding them would break query strings and fragments.

/** Escapes `& < > " '` for both HTML text content and attribute values. */
export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Percent-encode characters that would break a URL inside a markdown link
 *  target `(…)` or an HTML `href="…"` attribute. */
export function mdUrl(u: string): string {
  return u.replace(/[ ()<>"`]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
