// Timeline layout (Views API `timeline`) for inline databases. Each row is a
// horizontal bar derived from its start/end dates over the global span;
// degrades to a start-sorted table when nothing spans time.

import { rowTitle } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl } from "../util.js";
import { dateEndOf, dateStartOf, epochDay, pickDateKey, renderUndatedList } from "./shared.js";
import { renderTableView } from "./table.js";

/** Timeline layout (Views API `timeline`). Each row is a horizontal bar whose
 * left offset + width are derived from its start/end dates over the global
 * min→max span. The bar end is the explicit end-date property when present,
 * else the date property's own range end, else the start (point). Degrades to
 * a start-sorted table when no date column exists or every row is a point
 * (nothing to span). */
export function renderTimelineView(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  header: string,
  filterStrip: string,
  startPropName: string | undefined,
  endPropName: string | undefined,
  resolveLink?: ResolveLink,
  visibleProps?: string[],
): string {
  const startKey = pickDateKey(schema, startPropName);
  if (!startKey) {
    return renderTableView(data, rows, schema, header, resolveLink, filterStrip, visibleProps);
  }
  const endKey = endPropName && schema[endPropName]?.type === "date" ? endPropName : undefined;
  const bars: Array<{ row: DatabaseRow; s: number; e: number }> = [];
  const undated: DatabaseRow[] = [];
  for (const row of rows) {
    const sStr = dateStartOf(row, startKey);
    const s = sStr ? epochDay(sStr) : Number.NaN;
    if (Number.isNaN(s)) {
      undated.push(row);
      continue;
    }
    const eStr = (endKey ? dateStartOf(row, endKey) : undefined) ?? dateEndOf(row, startKey);
    const e = eStr ? epochDay(eStr) : s;
    bars.push({ row, s, e: Number.isNaN(e) || e < s ? s : e });
  }
  const tableFallback = () => {
    const sorted = [...bars].sort((a, b) => a.s - b.s).map((b) => b.row);
    return renderTableView(
      data,
      [...sorted, ...undated],
      schema,
      header,
      resolveLink,
      filterStrip,
      visibleProps,
    );
  };
  if (bars.length === 0) return tableFallback();
  const min = Math.min(...bars.map((b) => b.s));
  const max = Math.max(...bars.map((b) => b.e));
  const span = max - min;
  // Nothing actually spans time (all points / single day) → a bar chart adds
  // no information over a start-sorted table.
  if (span <= 0 || !bars.some((b) => b.e > b.s)) return tableFallback();
  const barsHtml = bars
    .sort((a, b) => a.s - b.s || a.e - b.e)
    .map((b) => {
      const left = ((b.s - min) / span) * 100;
      // Floor the width so a 1-day bar over a long span stays visible.
      const width = Math.max(((b.e - b.s) / span) * 100, 1.5);
      const href = data.rowHrefs?.get(b.row.id);
      const t = rowTitle(b.row, schema);
      const label = href
        ? `<a class="timeline-bar-link" href="${mdUrl(href)}">${t}</a>`
        : `<span class="timeline-bar-link">${t}</span>`;
      return `<div class="timeline-row"><div class="timeline-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%">${label}</div></div>`;
    })
    .join("");
  const fmt = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
  const axis = `<div class="timeline-axis"><span class="timeline-axis-start">${escapeHtmlText(fmt(min))}</span><span class="timeline-axis-end">${escapeHtmlText(fmt(max))}</span></div>`;
  const undatedHtml = renderUndatedList(undated, data, schema, "No date");
  return `<section class="inline-db timeline">${header}${filterStrip}${axis}<div class="timeline-bars">${barsHtml}</div>${undatedHtml}</section>`;
}
