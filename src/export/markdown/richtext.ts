// Rich-text + KaTeX rendering. Walks Notion's `rich_text[]` and emits the
// HTML/markdown-safe string that flows into block bodies, table cells, and
// property values.

import katex from "katex";
import type { ResolveLink, RichText, RichTextItem } from "./types.js";
import { escapeHtmlText, mdUrl, safeLinkUrl } from "./util.js";

// Server-side KaTeX render — produces span/HTML markup the browser styles via
// `katex.min.css`. `throwOnError:false` flips KaTeX into "render parse errors
// as red text" mode; we still wrap in try/catch since older KaTeX versions
// throw for some classes of failure regardless of the flag.
//
// Process-wide cache: KaTeX parsing is ~5-10 ms per expression and Notion
// users repeat the same equations constantly (`\sigma`, `x^2`, …). The cache
// is keyed by display-mode + expression and capped at 5000 entries — exports
// are batch jobs, so a crude clear-when-full eviction is sufficient.
const katexCache = new Map<string, string | null>();

export function renderKatex(expr: string, displayMode: boolean): string | null {
  const key = `${displayMode ? "B" : "I"}${expr}`;
  const cached = katexCache.get(key);
  if (cached !== undefined) return cached;
  let html: string | null;
  try {
    html = katex.renderToString(expr, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    html = null;
  }
  if (katexCache.size > 5000) katexCache.clear();
  katexCache.set(key, html);
  return html;
}

function sameRichTextStyle(a: RichTextItem, b: RichTextItem): boolean {
  if (a.type !== "text" || b.type !== "text") return false;
  if ((a.href ?? null) !== (b.href ?? null)) return false;
  const aa = a.annotations ?? {};
  const bb = b.annotations ?? {};
  return (
    !!aa.bold === !!bb.bold &&
    !!aa.italic === !!bb.italic &&
    !!aa.strikethrough === !!bb.strikethrough &&
    !!aa.code === !!bb.code
  );
}

// Notion frequently splits a styled run into several adjacent rich_text items
// (e.g. one bold word becomes two bold items because of an edit boundary).
// Naively wrapping each item in `**…**` then produces `**A****B**` which
// marked sometimes renders as literal asterisks. Coalesce identical-style
// neighbours into a single item before emitting.
function coalesceRichText(text: RichText): RichText {
  const out: RichText = [];
  for (const item of text) {
    const last = out[out.length - 1];
    if (last && sameRichTextStyle(last, item)) {
      const merged: RichTextItem = {
        ...last,
        plain_text: (last.plain_text ?? "") + (item.plain_text ?? ""),
      };
      if (last.text || item.text) {
        merged.text = {
          content: (last.text?.content ?? "") + (item.text?.content ?? ""),
          link: last.text?.link ?? item.text?.link ?? null,
        };
      }
      out[out.length - 1] = merged;
    } else {
      out.push(item);
    }
  }
  return out;
}

// Wraps a styled run using inline HTML tags. We fall back to HTML (instead of
// `**`/`*`/`~~`) when emphasis would otherwise be adjacent to a word boundary
// that marked refuses to parse — e.g. `**foo:**25` stays literal because the
// closing `**` sits between punctuation and an alphanumeric. We can't know the
// surrounding text from inside applyStyles, so when annotations are present we
// always emit HTML; markdown markers were a nicety, not a guarantee.
function wrapHtml(s: string, tag: string): string {
  if (!s) return s;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m?.[2]) return s;
  return `${m[1]}<${tag}>${m[2]}</${tag}>${m[3]}`;
}

// Notion stores in-workspace links in a few shapes, all carrying a 32-hex
// page id: `/<32-hex-id>`, `/<title-slug>-<id>`, and the short public form
// `/p/<id>` — optionally fully-qualified with `https://www.notion.so` and an
// optional `#<block-id>` fragment. Detect any of them and rewrite to a local
// page link if the resolver knows the target — otherwise leave the original
// href (it'll deep-link into Notion in the browser).
function maybeRewriteNotionHref(href: string, resolveLink?: ResolveLink): string {
  const m = href.match(
    /^(?:https?:\/\/(?:www\.)?notion\.so)?\/(?:p\/)?(?:[^/]+-)?([0-9a-f]{32})(#[0-9a-f]+)?$/i,
  );
  if (!m?.[1]) return href;
  const hex = m[1];
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const link = resolveLink?.(uuid);
  if (!link) return href;
  // Drop block-anchor fragments — we don't preserve block ids in rendered HTML.
  return link.href;
}

export function applyStyles(
  line: string,
  t: RichTextItem,
  alreadyLinked: boolean,
  resolveLink?: ResolveLink,
): string {
  let p = line;
  const a = t.annotations ?? {};
  // Emit `<code>` directly instead of markdown backticks. The input `p` is
  // already HTML-escaped (rt() runs `escapeHtmlText` on `plain_text` before
  // calling applyStyles), and marked would re-escape `&` inside backtick-
  // wrapped text — `it's` would surface as literal `it&#39;s` in the browser.
  if (a.code) p = `<code>${p}</code>`;
  if (a.bold) p = wrapHtml(p, "strong");
  if (a.italic) p = wrapHtml(p, "em");
  if (a.strikethrough) p = wrapHtml(p, "del");
  if (a.underline) p = wrapHtml(p, "u");
  // Wrap the emphasised text inside the link, not the link inside emphasis,
  // so marked parses the link grammar before stumbling on HTML tags.
  if (t.href && !alreadyLinked) {
    const href = safeLinkUrl(maybeRewriteNotionHref(t.href, resolveLink));
    p = `[${p}](${mdUrl(href)})`;
  }
  // Notion uses `default` for "no color" — anything else (red/yellow/…/
  // <color>_background) maps to a `t-<color>` span the stylesheet paints.
  if (a.color && a.color !== "default") {
    const safe = a.color.replace(/[^a-z_]/g, "");
    p = `<span class="t-${safe}">${p}</span>`;
  }
  return p;
}

export function rt(text: RichText | undefined, resolveLink?: ResolveLink): string {
  if (!text) return "";
  const joined = coalesceRichText(text)
    .map((t) => {
      // Escape `<`, `>`, `&` in every Notion-supplied plain_text run before
      // it flows into the markdown stream — marked accepts raw HTML in
      // markdown source, so an untrusted `<script>` in a page title would
      // otherwise execute when the export is opened.
      let s = escapeHtmlText(t.plain_text ?? "");
      let alreadyLinked = false;
      // Inline equation rich_text: render via KaTeX. Once rendered, the span
      // is final HTML — bypass annotation/href wrapping (which would corrupt
      // the KaTeX markup). Fall back to a literal `$expr$` `<code>` span when
      // KaTeX can't parse it.
      if (t.type === "equation") {
        const expr = t.equation?.expression ?? t.plain_text ?? "";
        const html = renderKatex(expr, false);
        if (html) {
          return `<span class="katex-inline">${html}</span>`;
        }
        return `<code class="katex-failed">$${escapeHtmlText(expr)}$</code>`;
      }
      const mention = t.mention;
      if (t.type === "mention" && mention) {
        const id =
          (mention.type === "page" && mention.page?.id) ||
          (mention.type === "database" && mention.database?.id) ||
          "";
        if (id) {
          const link = resolveLink?.(id);
          if (link) {
            // Emit `<a>` HTML directly rather than `[title](href)` markdown:
            // when the mention text lands in a title/rich_text DB cell that
            // goes through `mdLinksToAnchors`, a literal `]` in `link.title`
            // would truncate the `[^\]]+` capture and leak the closing
            // bracket. Going straight to HTML also lets us gate the href
            // through `safeLinkUrl` like every other URL-bearing emission.
            s = `<a href="${mdUrl(safeLinkUrl(link.href))}">${escapeHtmlText(link.title)}</a>`;
            alreadyLinked = true;
          }
        }
        // Notion custom emojis arrive as `:name:` plain_text plus a mention
        // with `custom_emoji.{url,name}`. Render the image inline so the
        // reader sees the icon instead of literal `:name:`.
        if (mention.type === "custom_emoji" && mention.custom_emoji?.url) {
          const name = mention.custom_emoji.name ?? "";
          const local = (mention.custom_emoji as { local_path?: string }).local_path;
          if (local) {
            // Defense-in-depth: a tampered raw JSON could plant a
            // `javascript:`/`data:` scheme into `local_path`. Every other
            // src/href emit in this file gates with `safeLinkUrl` — mirror that.
            s = `<img class="custom-emoji" src="${mdUrl(safeLinkUrl(local))}" alt="${escapeHtmlText(name)}" title="${escapeHtmlText(name)}">`;
          } else {
            // SECURITY: when the asset hasn't been downloaded (`local_path`
            // missing) we MUST NOT emit the remote Notion S3 URL — those
            // URLs carry `X-Amz-Signature` query params and expire after
            // ~1h. Render the literal `:slug:` shortcode instead.
            s = escapeHtmlText(`:${name}:`);
          }
          alreadyLinked = true;
        }
      }
      const a = t.annotations ?? {};
      // Apply styles per-line so emphasis markers (`**`, `*`, `~~`) never span
      // a soft line break. Code spans are kept whole since `\n` inside code
      // is legitimate content.
      if (a.code || !s.includes("\n")) {
        return applyStyles(s, t, alreadyLinked || s.startsWith("["), resolveLink);
      }
      const lines = s.split("\n");
      const styled = lines.map((line) =>
        applyStyles(line, t, alreadyLinked || line.startsWith("["), resolveLink),
      );
      return styled.join("<br>");
    })
    .join("");
  return joined;
}

// Rewrite any `[text](href)` markdown link spans inside an already-HTML cell
// value to `<a href="…">text</a>`. The cell content is inserted into a `<td>`
// verbatim, so leftover markdown links would render as literal brackets. The
// `text` portion is HTML-safe (it's the styled output of `rt()`), so we keep
// it as-is rather than re-escaping — that preserves <strong>/<em>/etc.
//
// Exported so co-located callers (pipeline.pagePropertiesRow) and tests can
// reuse the exact same conversion without re-implementing it.
export function mdLinksToAnchors(s: string): string {
  if (!s) return "";
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => {
    return `<a href="${mdUrl(safeLinkUrl(h))}">${t}</a>`;
  });
}
