// Gallery (card) layout for inline databases — used for the Views API
// `gallery` type and as the auto-heuristic choice when rows carry covers.

import { renderPropertyValue, rowTitle } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl } from "../util.js";
import { filterDataAttrs } from "./shared.js";

export function renderGalleryView(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  header: string,
  resolveLink?: ResolveLink,
  filterStrip = "",
): string {
  const titleKey = Object.keys(schema).find((k) => schema[k]?.type === "title");
  // Pick a handful of additional properties to show under the title — first
  // select/multi_select for chips, then short value-bearing props (number,
  // url, etc.). Skip ones that are usually empty or noisy.
  const skip = new Set(["created_time", "last_edited_time", "created_by", "last_edited_by"]);
  const chipKeys = Object.keys(schema).filter(
    (k) =>
      k !== titleKey &&
      (schema[k]?.type === "select" ||
        schema[k]?.type === "multi_select" ||
        schema[k]?.type === "status"),
  );
  const detailKeys = Object.keys(schema).filter(
    (k) =>
      k !== titleKey &&
      !skip.has(schema[k]?.type ?? "") &&
      schema[k]?.type !== "select" &&
      schema[k]?.type !== "multi_select" &&
      schema[k]?.type !== "status",
  );
  // Filter strip chips/ranges match cards by reading `[data-col][data-filter-…]`
  // off each card. The visible chips/details don't reliably carry those attrs
  // (and may be capped/omitted), so — exactly like kanban — emit one hidden
  // span per filterable column. Without these, any active chip/date/number
  // filter rejects every gallery card (cellValueFor → null → no match).
  const filterableKeys = Object.keys(schema).filter((k) => {
    const t = schema[k]?.type;
    return (
      t === "select" || t === "status" || t === "multi_select" || t === "date" || t === "number"
    );
  });
  const cards = rows
    .map((row) => {
      const id = row.id;
      const cover = data.rowCovers?.get(id);
      const icon = data.rowIcons?.get(id);
      const href = data.rowHrefs?.get(id);
      const coverHtml = cover
        ? `<div class="db-card-cover"><img src="${mdUrl(cover)}" alt="" loading="lazy"></div>`
        : `<div class="db-card-cover db-card-cover-empty" aria-hidden="true"></div>`;
      const iconHtml = icon
        ? `<img class="db-card-icon" src="${mdUrl(icon)}" alt="" loading="lazy">`
        : "";
      const title = rowTitle(row, schema);
      const titleHtml = href
        ? `<a class="db-card-title" href="${mdUrl(href)}">${iconHtml}${title}</a>`
        : `<span class="db-card-title">${iconHtml}${title}</span>`;
      const chips = chipKeys
        .map((k) => renderPropertyValue(row.properties?.[k], resolveLink))
        .filter(Boolean)
        .slice(0, 4);
      const chipsHtml = chips.length ? `<div class="db-card-chips">${chips.join(" ")}</div>` : "";
      const details = detailKeys
        .map((k) => {
          const v = renderPropertyValue(row.properties?.[k], resolveLink);
          if (!v) return "";
          // Boolean/date/people property values are meaningless without their
          // column name (a lone "✓" or "2022-02-19" tells you nothing). Prefix
          // them with the property label; for everything else the value alone
          // carries the meaning (url, price, weight, …) so we omit the noise.
          const t = schema[k]?.type;
          const labeled = t === "checkbox" || t === "date" || t === "people";
          if (labeled) {
            return `<div class="db-card-detail"><span class="db-card-label">${escapeHtmlText(k)}</span> <span class="db-card-value">${v}</span></div>`;
          }
          return `<div class="db-card-detail">${v}</div>`;
        })
        .filter(Boolean)
        .slice(0, 4);
      const detailsHtml = details.length
        ? `<div class="db-card-body">${details.join("")}</div>`
        : "";
      const filterData = filterableKeys
        .map((k) => {
          const attrs = filterDataAttrs(row.properties?.[k], schema[k]?.type);
          return attrs
            ? `<span class="db-card-filter-data" data-col="${escapeHtmlText(k)}"${attrs} hidden></span>`
            : "";
        })
        .join("");
      return `<article class="db-card" data-row-id="${escapeHtmlText(id)}">${coverHtml}<div class="db-card-meta">${titleHtml}${chipsHtml}${detailsHtml}</div>${filterData}</article>`;
    })
    .join("");
  return `<section class="inline-db inline-db-gallery">${header}${filterStrip}<div class="db-cards">${cards}</div><p class="inline-db-empty inline-db-empty-filter" data-empty-state hidden>No rows match these filters. <a href="#" data-empty-clear>Clear filters</a></p></section>`;
}
