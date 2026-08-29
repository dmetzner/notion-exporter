// Table layout for inline databases — also the fallback renderer for view
// types we don't draw natively (form/chart/map/dashboard) and for
// calendar/timeline when no date column is available.

import { UNTITLED_PAGE } from "../../paths.js";
import { renderPropertyValue } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl } from "../util.js";
import { filterDataAttrs } from "./shared.js";

export function renderTableView(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  header: string,
  resolveLink?: ResolveLink,
  filterStrip = "",
  visibleProps?: string[],
): string {
  const columns = orderColumns(schema, rows, visibleProps);
  if (columns.length === 0) {
    return `<section class="inline-db">${header}<p class="inline-db-empty">No rows.</p></section>`;
  }
  const headHtml = `<tr>${columns
    .map(
      (c, i) =>
        `<th data-sort-col="${i}" data-col-name="${escapeHtmlText(c)}" tabindex="0" role="button">${escapeHtmlText(c)}<span class="sort-arrow" aria-hidden="true"></span></th>`,
    )
    .join("")}</tr>`;
  const titleKey = columns.find((c) => schema[c]?.type === "title");
  const bodyHtml = rows
    .map((row) => {
      const rowHref = data.rowHrefs?.get(row.id);
      const tds = columns
        .map((c) => {
          const cellValue = renderPropertyValue(row.properties?.[c], resolveLink);
          const filterAttrs = filterDataAttrs(row.properties?.[c], schema[c]?.type);
          // Wrap the title cell's content in an <a> pointing at the row's
          // detail page so the table view becomes navigable (matches Notion
          // and the gallery view). Wrapping the entire <tr> in <a> would be
          // invalid HTML, so the link sits inside the title <td> only.
          if (c === titleKey && rowHref) {
            const inner = cellValue || escapeHtmlText(UNTITLED_PAGE);
            return `<td class="db-row-title-cell" data-col="${escapeHtmlText(c)}"${filterAttrs}><a class="db-row-link" href="${mdUrl(rowHref)}">${inner}</a></td>`;
          }
          return `<td data-col="${escapeHtmlText(c)}"${filterAttrs}>${cellValue}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<section class="inline-db">${header}${filterStrip}<div class="inline-db-table-wrap"><table class="inline-db-table"><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table></div><p class="inline-db-empty inline-db-empty-filter" data-empty-state hidden>No rows match these filters. <a href="#" data-empty-clear>Clear filters</a></p></section>`;
}

function orderColumns(
  schema: Record<string, { type?: string }>,
  rows: Array<{ properties?: Record<string, unknown> }>,
  visibleProps?: string[],
): string[] {
  const schemaKeys = Object.keys(schema);
  // When the primary view supplies a visible-property set, it is authoritative
  // for both *which* columns show and their order. Keep only the ones the
  // schema knows about (drops hand-edited/renamed names), then title-first so
  // the row-link cell stays leftmost (matches the heuristic path + Notion).
  if (visibleProps && visibleProps.length > 0) {
    const known = visibleProps.filter((k) => schema[k]);
    if (known.length > 0) {
      const titleKey = known.find((k) => schema[k]?.type === "title");
      return titleKey ? [titleKey, ...known.filter((k) => k !== titleKey)] : known;
    }
  }
  // schema gives stable order; fall back to keys observed in first row
  if (schemaKeys.length > 0) {
    // put `title`-typed column first if not already
    const titleKey = schemaKeys.find((k) => schema[k]?.type === "title");
    if (titleKey && schemaKeys[0] !== titleKey) {
      return [titleKey, ...schemaKeys.filter((k) => k !== titleKey)];
    }
    return schemaKeys;
  }
  return Object.keys(rows[0]?.properties ?? {});
}
