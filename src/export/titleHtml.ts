// Shared `:slug:` → `<img class="custom-emoji">` enrichment for titles.
//
// Why this lives here: four near-identical helpers existed across
// `commands/export.ts`, `commands/rerender.ts`, `commands/repair.ts` and
// `export/pipeline.ts`. Two of them (pipeline + repair) had drifted off the
// attr-escape-first pattern, shipping raw-title XSS into sidebar entries,
// breadcrumbs, page-link cards, and the repair-built sitemap. Consolidating
// them into one function eliminates that drift hazard by construction.
//
// CONTRACT: `enrichTitleHtml` ALWAYS returns HTML — even when the title
// contained no shortcodes, the returned value is the attr-escaped form. The
// caller cannot tell from the return shape whether enrichment happened. If a
// caller needs to fall back to a downstream escape (e.g. injectSidebars'
// htmlEscape over `entry.title`), it must inspect the input title for
// shortcodes BEFORE calling this — see `enrichTitleHtmlIfShortcodes`.

// v7-tech-debt MED-1/MED-2: the local `attrEsc` + `urlEsc` copies were
// consolidated into `./htmlEscape.ts`. Kept as local re-imports so the call
// sites below read the same way.
import { escapeHtmlText as attrEsc, mdUrl as urlEsc } from "./htmlEscape.js";

/** `:name:` slug grammar. Pinned so callers cannot widen it (a wider regex
 *  would let attrEsc-escaped characters re-appear inside a match group and
 *  break the attr-escape-first invariant below). */
const EMOJI_RE = /:([a-zA-Z0-9_\-+]+):/g;

/**
 * Enrich a plain-text title into HTML, swapping `:slug:` shortcodes that
 * resolve in `customEmojiByName` for `<img class="custom-emoji">` tags.
 *
 * SECURITY: the whole title is `attrEsc`-escaped FIRST, then `:slug:` matches
 * are re-found in the escaped string (the slug grammar `[a-zA-Z0-9_\-+]` is
 * untouched by `attrEsc`, so the same matches reappear). This ordering
 * guarantees that any HTML-meaningful character outside a shortcode match
 * (e.g. `<script>`, `"`, `>`) ships escaped — never as raw markup.
 *
 * Always returns a string. When the title contains no resolvable shortcode,
 * the returned value is the attr-escaped form of the input title.
 *
 * @param title              The operator-untrusted plain-text title.
 * @param customEmojiByName  `:name:` → src path (caller's choice of
 *                           representation — root-relative or absolute).
 * @param resolveSrc         Maps the raw map value to the final `src=…`
 *                           value. Pass identity for root-relative emission
 *                           (sitemap / repair), or a depth-relative fn for
 *                           page-context emission (pipeline.enrichTitle).
 */
export function enrichTitleHtml(
  title: string,
  customEmojiByName: Map<string, string>,
  resolveSrc: (local: string) => string = (s) => s,
): string {
  const escaped = attrEsc(title);
  if (customEmojiByName.size === 0) return escaped;
  return escaped.replace(EMOJI_RE, (m, name) => {
    const local = customEmojiByName.get(name);
    if (!local) return m;
    // `resolveSrc` can throw (pipeline.ts wires `assertWithinRoot`, which
    // rejects path-traversing local_paths on a tampered raw tree). A throw
    // here would abort the entire render and prevent the page from being
    // written; degrade gracefully by returning the literal `:slug:` so the
    // rest of the title still renders.
    let src: string;
    try {
      src = resolveSrc(local);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug(
        `notion-exporter: enrichTitleHtml resolveSrc threw for :${name}: — keeping literal shortcode (${(err as Error).message ?? err})`,
      );
      return m;
    }
    const safeName = attrEsc(name);
    return `<img class="custom-emoji" src="${urlEsc(src)}" alt="${safeName}" title="${safeName}">`;
  });
}
