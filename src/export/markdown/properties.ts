// Property rendering — Notion's `properties[]` shape becomes plain text
// (`formatProp`), interactive HTML cells (`renderPropertyValue`), or a
// page-header property table.

import { UNTITLED_PAGE } from "../paths.js";
import { mdLinksToAnchors, rt } from "./richtext.js";
import type { DatabaseRow, MarkdownOptions, ResolveLink, RichText } from "./types.js";
import { escapeHtmlText, mdUrl, safeLinkUrl } from "./util.js";

// Notion property types whose `formatProp` output is already final HTML.
// `relation` emits `<a>` tags directly (via `escapeHtmlText`+`safeLinkUrl`);
// `rollup` recurses into `formatProp` (renderPropertyValue runs the joined
// result through `mdLinksToAnchors` so inner rich_text href annotations
// surface as inline anchors); `title` / `rich_text` go through `rt()` which
// escapes plain_text per run. Every OTHER branch of `formatProp` returns raw
// operator-controlled text (select/status `.name`, email, phone_number, url,
// people `.name`, files `.name`, …) and MUST be HTML-escaped before
// interpolation into `<td>${value}</td>`. Co-located with `formatProp` so the
// two cannot drift (pipeline.ts imports this set).
export const HTML_EMITTING_PROP_TYPES = new Set(["title", "rich_text", "relation", "rollup"]);

export function rowTitle(row: DatabaseRow, schema: Record<string, { type?: string }>): string {
  const titleKey = Object.keys(schema).find((k) => schema[k]?.type === "title");
  if (titleKey) {
    const v = row.properties?.[titleKey] as { title?: RichText } | undefined;
    const t = (v?.title ?? []).map((x) => x.plain_text ?? "").join("");
    if (t) return escapeHtmlText(t);
  }
  return UNTITLED_PAGE;
}

export function renderSelectChip(value: unknown): string {
  const v = value as { name?: string; color?: string };
  if (!v?.name) return "";
  const color = (v.color ?? "default").replace(/[^a-z_]/g, "");
  return `<span class="db-chip c-${color}">${escapeHtmlText(v.name)}</span>`;
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export function renderPropertyValue(value: unknown, resolveLink?: ResolveLink): string {
  const p = value as { type?: string } & Record<string, unknown>;
  if (p?.type === "select") return renderSelectChip(p.select);
  if (p?.type === "multi_select") {
    const items = (p.multi_select as Array<{ name?: string; color?: string }>) ?? [];
    return items.map((i) => renderSelectChip(i)).join(" ");
  }
  if (p?.type === "status") return renderSelectChip(p.status);
  // Title and rich_text already render to safe inline HTML via rt() — bold,
  // italic etc. should survive into the cell. But rt() also emits markdown
  // `[text](url)` for href annotations; convert those to inline anchors so
  // the cell HTML is final (otherwise users see literal brackets in <td>s).
  if (p?.type === "title" || p?.type === "rich_text") {
    return mdLinksToAnchors(formatProp(p, resolveLink));
  }
  if (p?.type === "relation") {
    // formatProp("relation") now emits final `<a>` HTML directly — title is
    // already passed through `escapeHtmlText` and href through `safeLinkUrl`.
    // No regex round-trip needed; just return as-is.
    return formatProp(p, resolveLink);
  }
  if (p?.type === "rollup") {
    // Rollup arrays may contain relation entries, which formatProp emits as
    // raw `<a>` HTML. Don't fall through to the generic `escapeHtmlText`
    // tail or users see literal `&lt;a&gt;` text in DB cells.
    //
    // Rollups can also contain rich_text / title items whose `rt()` output
    // carries `[text](url)` markdown link syntax for href annotations. The
    // joined formatProp result for rollup lands in a `<td>` verbatim, so
    // leftover markdown brackets would render literally unless we run the
    // same `mdLinksToAnchors` pass that title/rich_text use above. Relation
    // HTML already emitted by formatProp has no `[…](…)` shape so it survives
    // this pass unchanged.
    return mdLinksToAnchors(formatProp(p, resolveLink));
  }
  const formatted = formatProp(p, resolveLink);
  if (!formatted) return "";
  if (p?.type === "url") {
    const href = /^[a-z][a-z0-9+\-.]*:/i.test(formatted) ? formatted : `https://${formatted}`;
    return `<a class="db-url" href="${mdUrl(safeLinkUrl(href))}">${escapeHtmlText(shortUrl(href))}</a>`;
  }
  return escapeHtmlText(formatted);
}

export function renderPropertyTable(props: MarkdownOptions["properties"]): string {
  if (!props || props.length === 0) return "";
  const rows = props.map((p) => `<tr><th>${escapeHtmlText(p.name)}</th><td>${p.value}</td></tr>`);
  return `<table class="page-props"><tbody>${rows.join("")}</tbody></table>\n\n`;
}

export function formatProp(v: unknown, resolveLink?: ResolveLink): string {
  // A schema/dataSource may list a property a given row lacks (e.g. linked-view
  // rescued rows whose source carries more columns than a view shows). Treat a
  // missing cell as empty rather than dereferencing `undefined.type`.
  if (v == null || typeof v !== "object") return "";
  const p = v as { type?: string } & Record<string, unknown>;
  switch (p.type) {
    case "title":
    case "rich_text":
      return rt(p[p.type] as RichText, resolveLink);
    case "number":
      return String(p.number ?? "");
    case "select":
      return ((p.select as { name?: string })?.name ?? "") as string;
    case "multi_select":
      return (p.multi_select as Array<{ name?: string }>).map((s) => s.name ?? "").join(", ");
    case "status":
      return ((p.status as { name?: string })?.name ?? "") as string;
    case "date": {
      const d = p.date as { start?: string; end?: string };
      if (!d?.start) return "";
      if (!d.end) return d.start;
      return `${d.start} → ${d.end}`;
    }
    case "checkbox":
      return p.checkbox ? "✓" : "✗";
    case "url":
      return (p.url as string) ?? "";
    case "email":
      return (p.email as string) ?? "";
    case "phone_number":
      return (p.phone_number as string) ?? "";
    case "relation": {
      // Emit `<a>` HTML directly instead of a `[title](href)` markdown
      // intermediate: the cell ends up in a `<td>` (page-props table /
      // DB-row table), and the regex round-trip used to fail when
      // `link.title` contained a literal `]` (the `[^\]]+` capture
      // truncated). Going straight to HTML also lets us pipe the title
      // through `escapeHtmlText` and the href through `safeLinkUrl` — the
      // same gates every other URL-bearing emission uses.
      const rel = (p.relation as Array<{ id?: string }>) ?? [];
      return rel
        .map((r) => {
          if (!r.id) return "";
          const link = resolveLink?.(r.id);
          if (!link) return r.id;
          return `<a href="${mdUrl(safeLinkUrl(link.href))}">${escapeHtmlText(link.title)}</a>`;
        })
        .filter(Boolean)
        .join(", ");
    }
    case "people":
      return ((p.people as Array<{ name?: string }>) ?? [])
        .map((u) => u.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "created_by":
    case "last_edited_by":
      return ((p[p.type] as { name?: string })?.name ?? "") as string;
    case "created_time":
    case "last_edited_time":
      return (p[p.type] as string) ?? "";
    case "formula": {
      const f = p.formula as {
        type?: string;
        string?: string;
        number?: number;
        boolean?: boolean;
        date?: { start?: string };
      };
      switch (f?.type) {
        case "string":
          return f.string ?? "";
        case "number":
          return String(f.number ?? "");
        case "boolean":
          return f.boolean ? "✓" : "✗";
        case "date":
          return f.date?.start ?? "";
        default:
          return "";
      }
    }
    case "rollup": {
      const r = p.rollup as {
        type?: string;
        array?: unknown[];
        number?: number;
        date?: { start?: string };
      };
      if (r?.type === "number") return String(r.number ?? "");
      if (r?.type === "date") return r.date?.start ?? "";
      if (r?.type === "array") {
        // Per-item: formatProp emits HTML for relation / title / rich_text
        // (already gated through escapeHtmlText / safeLinkUrl); every other
        // inner type returns operator-untrusted raw text. The joined result
        // lands in a `<td>` verbatim (renderPropertyValue's rollup branch
        // skips the tail-escape), so escape raw-text items here. Without
        // this, a rollup-of-people with a member named `Bob <Admin>` would
        // surface unescaped `<Admin>` in the cell.
        return (r.array ?? [])
          .map((x) => {
            const formatted = formatProp(x, resolveLink);
            if (!formatted) return "";
            const innerType = (x as { type?: string })?.type;
            if (innerType === "relation" || innerType === "title" || innerType === "rich_text") {
              return formatted;
            }
            return escapeHtmlText(formatted);
          })
          .filter(Boolean)
          .join(", ");
      }
      return "";
    }
    case "files":
      return (
        (p.files as Array<{
          name?: string;
          type?: string;
          external?: { url?: string };
          file?: { url?: string };
        }>) ?? []
      )
        .map((f) => f.name ?? "")
        .filter(Boolean)
        .join(", ");
    default:
      return "";
  }
}
