// List layout (Views API `list`) and the compact card-list used for small
// inline DBs nested in a `column_list`.

import { renderPropertyValue, rowTitle } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl } from "../util.js";
import { filterDataAttrs, pickCompactRowMeta } from "./shared.js";

/** List layout (Views API `list`). A vertical row-per-line list — the row
 * title links to its page, with the view's visible properties (or, absent a
 * view, the compact-meta heuristic) shown inline. Keeps the inline-db header +
 * filter strip, and emits the same hidden filter-data spans as the table /
 * kanban views so the client filter JS works unchanged. */
export function renderListView(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  header: string,
  filterStrip: string,
  resolveLink?: ResolveLink,
  visibleProps?: string[],
): string {
  const titleKey = Object.keys(schema).find((k) => schema[k]?.type === "title");
  const metaKeys = visibleProps?.filter((k) => k !== titleKey && schema[k]);
  const filterableKeys = Object.keys(schema).filter((k) => {
    const t = schema[k]?.type;
    return (
      t === "select" || t === "status" || t === "multi_select" || t === "date" || t === "number"
    );
  });
  const items = rows
    .map((row) => {
      const href = data.rowHrefs?.get(row.id);
      const titleHtml = rowTitle(row, schema);
      const linkHtml = href
        ? `<a class="db-list-link" href="${mdUrl(href)}">${titleHtml}</a>`
        : `<span class="db-list-link">${titleHtml}</span>`;
      // View-supplied visible props win; otherwise the same 2-prop heuristic
      // the compact list uses.
      const meta =
        metaKeys && metaKeys.length > 0
          ? metaKeys
              .map((k) => renderPropertyValue(row.properties?.[k], resolveLink))
              .filter(Boolean)
              .slice(0, 4)
              .join(" ")
          : pickCompactRowMeta(row, schema, titleKey, resolveLink);
      const metaHtml = meta ? `<span class="db-list-meta">${meta}</span>` : "";
      const filterData = filterableKeys
        .map((k) => {
          const attrs = filterDataAttrs(row.properties?.[k], schema[k]?.type);
          return attrs
            ? `<span class="db-list-filter-data" data-col="${escapeHtmlText(k)}"${attrs} hidden></span>`
            : "";
        })
        .join("");
      return `<li class="db-list-row" data-row-id="${escapeHtmlText(row.id)}">${linkHtml}${metaHtml}${filterData}</li>`;
    })
    .join("");
  return `<section class="inline-db inline-db-list">${header}${filterStrip}<ul class="db-list">${items}</ul><p class="inline-db-empty inline-db-empty-filter" data-empty-state hidden>No rows match these filters. <a href="#" data-empty-clear>Clear filters</a></p></section>`;
}

/** Compact card-list rendering for small inline DBs nested in a
 * `column_list`. Strips the inline-DB header chrome (no "Open full view"
 * link, no filter strip, no sort headers) and emits each row as a single-line
 * list item — title link plus at most two distinctive meta properties. The
 * goal is parity with how Notion itself renders small linked databases in a
 * column layout: a quiet bulletless list, not a wall of mini-tables. */
export function renderCompactList(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  resolveLink?: ResolveLink,
): string {
  const titleKey = Object.keys(schema).find((k) => schema[k]?.type === "title");
  const titleAttr = escapeHtmlText(data.title);
  const head = `<header class="inline-db-compact-head"><span class="inline-db-compact-title">${titleAttr}</span><span class="inline-db-compact-count">${rows.length}</span></header>`;
  const items = rows
    .map((row) => {
      const id = row.id;
      const titleHtml = rowTitle(row, schema);
      const href = data.rowHrefs?.get(id);
      const linkHtml = href
        ? `<a class="db-compact-link" href="${mdUrl(href)}">${titleHtml}</a>`
        : `<span class="db-compact-link">${titleHtml}</span>`;
      const meta = pickCompactRowMeta(row, schema, titleKey, resolveLink);
      const metaHtml = meta ? `<div class="db-compact-meta">${meta}</div>` : "";
      return `<li class="db-compact-row">${linkHtml}${metaHtml}</li>`;
    })
    .join("");
  return `<section class="inline-db inline-db-compact">${head}<ul class="db-compact-list">${items}</ul></section>`;
}
