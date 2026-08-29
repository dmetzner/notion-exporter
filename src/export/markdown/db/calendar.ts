// Calendar layout (Views API `calendar`) for inline databases. Buckets rows
// into one month grid per populated month; undated rows fall into a
// collapsible list. Degrades to the table renderer when no date column exists.

import { rowTitle } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl } from "../util.js";
import {
  dateStartOf,
  MONTH_NAMES,
  pickDateKey,
  renderUndatedList,
  WEEKDAY_NAMES,
} from "./shared.js";
import { renderTableView } from "./table.js";

/** Render one month as a 7-column day grid. Days are bucketed by day-of-month;
 * each cell lists its rows as title chips linking to the row page. */
function renderCalendarMonth(
  monthKey: string,
  days: Map<number, DatabaseRow[]>,
  data: ChildDatabaseData,
  schema: Record<string, { type?: string }>,
): string {
  const [yStr, moStr] = monthKey.split("-");
  const y = Number(yStr);
  const mo = Number(moStr); // 1-based
  const monthName = `${MONTH_NAMES[mo - 1] ?? monthKey} ${y}`;
  const firstDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const dowHeads = WEEKDAY_NAMES.map((d) => `<div class="calendar-dow">${d}</div>`).join("");
  const cells: string[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push(`<div class="calendar-cell calendar-cell-empty" aria-hidden="true"></div>`);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const rs = days.get(day) ?? [];
    const events = rs
      .map((row) => {
        const href = data.rowHrefs?.get(row.id);
        const t = rowTitle(row, schema);
        return href
          ? `<a class="calendar-event" href="${mdUrl(href)}">${t}</a>`
          : `<span class="calendar-event">${t}</span>`;
      })
      .join("");
    cells.push(
      `<div class="calendar-cell"><span class="calendar-daynum">${day}</span>${events}</div>`,
    );
  }
  return `<div class="calendar-month"><header class="calendar-month-head">${escapeHtmlText(monthName)}</header><div class="calendar-dows">${dowHeads}</div><div class="calendar-days">${cells.join("")}</div></div>`;
}

/** Calendar layout (Views API `calendar`). Buckets rows by their date
 * property into one month grid per populated month (chronological); undated
 * rows fall into a collapsible list. Degrades to a table when no date column
 * is available or no row carries a date. */
export function renderCalendarView(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  header: string,
  filterStrip: string,
  datePropName: string | undefined,
  resolveLink?: ResolveLink,
  visibleProps?: string[],
): string {
  const dateKey = pickDateKey(schema, datePropName);
  if (!dateKey) {
    return renderTableView(data, rows, schema, header, resolveLink, filterStrip, visibleProps);
  }
  const byMonth = new Map<string, Map<number, DatabaseRow[]>>();
  const undated: DatabaseRow[] = [];
  for (const row of rows) {
    const start = dateStartOf(row, dateKey);
    const m = start ? /^(\d{4})-(\d{2})-(\d{2})/.exec(start) : null;
    if (!m) {
      undated.push(row);
      continue;
    }
    const monthKey = `${m[1]}-${m[2]}`;
    const day = Number(m[3]);
    let dayMap = byMonth.get(monthKey);
    if (!dayMap) {
      dayMap = new Map();
      byMonth.set(monthKey, dayMap);
    }
    const cell = dayMap.get(day);
    if (cell) cell.push(row);
    else dayMap.set(day, [row]);
  }
  if (byMonth.size === 0) {
    return renderTableView(data, rows, schema, header, resolveLink, filterStrip, visibleProps);
  }
  const grids = [...byMonth.keys()]
    .sort()
    .map((mk) =>
      renderCalendarMonth(mk, byMonth.get(mk) as Map<number, DatabaseRow[]>, data, schema),
    )
    .join("");
  const undatedHtml = renderUndatedList(undated, data, schema, "Undated");
  return `<section class="inline-db calendar">${header}${filterStrip}<div class="calendar-months">${grids}</div>${undatedHtml}</section>`;
}
