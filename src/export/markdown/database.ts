// Inline-database renderers — `child_database` blocks and standalone DB
// pages. This module is the dispatcher: `renderInlineDatabase` resolves the
// layout (kanban / table / gallery / calendar / timeline / list / compact) per
// captured view and delegates to the per-layout renderers under `./db/`.

import type { Logger } from "../../logger.js";
import type { ViewSchema, ViewWithOrder } from "../../notion/views.js";
import { type DbViewConfig, parseDbConfig } from "../dbConfig.js";
import { UNTITLED_DB } from "../paths.js";
import { renderCalendarView } from "./db/calendar.js";
import { renderGalleryView } from "./db/gallery.js";
import { renderKanbanView } from "./db/kanban.js";
import { renderCompactList, renderListView } from "./db/list.js";
import {
  applyViewOrder,
  isKanbanShape,
  pickKanbanGroupKey,
  rankColumn,
  renderFilterStrip,
  resolveGroupKey,
} from "./db/shared.js";
import { renderTableView } from "./db/table.js";
import { renderTimelineView } from "./db/timeline.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "./types.js";
import { escapeHtmlText, mdUrl } from "./util.js";

// Re-exported for the markdown barrel + unit tests (rankColumn / applyViewOrder /
// pickKanbanGroupKey) which import from this module's public surface.
export { applyViewOrder, pickKanbanGroupKey, rankColumn };

function inferSchema(database: unknown, rows: DatabaseRow[]): Record<string, { type?: string }> {
  // Notion API v5 moved property schema onto `data_source` and leaves
  // `database.properties` as null. Fall back to inferring the schema from the
  // first row that has a typed `properties` map.
  const raw = (database as { properties?: Record<string, { type?: string }> | null })?.properties;
  if (raw && typeof raw === "object") return raw;
  const inferred: Record<string, { type?: string }> = {};
  for (const row of rows) {
    if (!row.properties) continue;
    for (const [k, v] of Object.entries(row.properties)) {
      if (inferred[k]) continue;
      const t = (v as { type?: string })?.type;
      if (t) inferred[k] = { type: t };
    }
  }
  return inferred;
}

/** Zero-row + generic-titled inline DBs render as a muted card
 * (see `renderInlineDatabase`). Predicate matches literal "Untitled", the
 * localized UNTITLED_DB sentinel, and empty string. */
function isUntitledPlaceholder(title: string): boolean {
  return title === "Untitled" || title === UNTITLED_DB || title === "";
}

/** Compact muted placeholder for zero-row Untitled inline DBs. Sized to fit
 * a `column_list` cell — smaller than a compact-list row, single line, no
 * filter strip, no sort headers, no block id (avoid exposing Notion
 * internals). `aria-hidden` because it carries no actionable content for
 * screen readers. */
function renderEmptyPlaceholder(): string {
  return `<section class="inline-db inline-db-empty-placeholder" aria-hidden="true"><span class="inline-db-empty-placeholder-icon" aria-hidden="true">∅</span><span class="inline-db-empty-placeholder-text">Empty</span></section>`;
}

export function renderInlineDatabase(
  data: ChildDatabaseData,
  resolveLink?: ResolveLink,
  dbView: "auto" | "table" | "kanban" = "auto",
  log?: Logger,
): string {
  const rows = data.rows as DatabaseRow[];
  // Zero-row inline DBs whose title is the generic "Untitled" placeholder
  // would otherwise early-return "" and silently disappear. Operators
  // commonly create lookup-table stubs awaiting content; silently dropping
  // them looks like a rendering bug and breaks column_list spacing. Emit a
  // tiny muted placeholder card instead — it preserves layout without
  // carrying filter chrome or sort headers.
  if (rows.length === 0 && isUntitledPlaceholder(data.title)) {
    return renderEmptyPlaceholder();
  }
  const schema = inferSchema(data.database, rows);
  // Parse the `%%notion-exporter` JSON fence (if any) out of the database's
  // description rich-text. Operators use this to override the renderer's
  // heuristics per-database without touching the CLI env.
  const config = parseDbConfig(data.database, log);
  const titleAttr = escapeHtmlText(data.title);
  // Zero-row NAMED inline DBs render as a single muted line — keep the
  // title visible (it carries semantic info, unlike "Untitled" placeholders
  // which collapse to a `∅ Empty` placeholder), but drop filter strip + sort
  // headers + "Open full view" link. One muted line, no chrome.
  if (rows.length === 0) {
    return `<section class="inline-db inline-db-empty-named"><span class="inline-db-empty-named-title">${titleAttr}</span><span class="inline-db-empty-named-state">Empty</span></section>`;
  }

  const views = data.views ?? [];
  // No captured views → single heuristic render (legacy / unviewed path).
  if (views.length === 0) {
    return renderSingleView(data, null, schema, config, dbView, resolveLink, log);
  }
  // One or more captured views → tabbed renderer (CSS radio tabs), always
  // labelling each tab with the view's name.
  return renderTabbedViews(data, views, schema, config, dbView, resolveLink, log);
}

/** Render one view of a database as a complete `<section class="inline-db …">`
 * — header (title + count + filter search + "open full view"), filter strip,
 * and the layout chosen for this view. `entry` carries the view config + its
 * filtered/sorted `rowOrder`; pass `null` for the legacy/heuristic path (no
 * captured view). Used directly for single-view DBs and once per tab for
 * multi-view DBs. */
function renderSingleView(
  data: ChildDatabaseData,
  entry: ViewWithOrder | null,
  schema: Record<string, { type?: string }>,
  config: DbViewConfig,
  dbView: "auto" | "table" | "kanban",
  resolveLink?: ResolveLink,
  log?: Logger,
): string {
  const view = entry?.view;
  // Apply this view's exact ordering + filtering before anything downstream —
  // the header count, filter strip, group-key pick, kanban column order, and
  // every layout operate on the rows as Notion presents them. No-op when there
  // is no `rowOrder` (legacy / unviewed).
  const rows = entry
    ? applyViewOrder(data.rows as DatabaseRow[], entry.rowOrder)
    : (data.rows as DatabaseRow[]);

  const linkSuffix = data.href
    ? ` <a class="inline-db-open" href="${mdUrl(data.href)}">Open full view ↗</a>`
    : "";
  const filterInput = `<input type="search" class="inline-db-filter" data-inline-db-filter placeholder="Filter…" autocomplete="off">`;
  const linkedNote = data.linkedSource
    ? `<p class="inline-db-linked-note">Linked view — Notion view filters not recoverable; showing full source DB.</p>`
    : "";
  const titleAttr = escapeHtmlText(data.title);
  const header = `<div class="inline-db-head"><span class="inline-db-title">${titleAttr}</span><span class="inline-db-count">${rows.length} rows</span>${filterInput}${linkSuffix}</div>${linkedNote}`;

  const filterStrip =
    config.hideFilters === true ? "" : renderFilterStrip(schema, rows, data.dataSource);

  const autoGroupKey = pickKanbanGroupKey(schema, rows, data.dataSource);
  const resolvedGroupKey = resolveGroupKey(
    config,
    schema,
    autoGroupKey,
    data.title,
    log,
    view?.groupByName,
  );

  // Precedence: operator `config.view` fence > the view's layout type (tier-0,
  // ground truth) > the `dbView` CLI param > the auto heuristic. The view
  // contributes `calendar`/`timeline`/`list`, which the fence and CLI can't.
  const resolvedView: ResolvedView =
    config.view ?? viewRendererType(view) ?? (dbView === "auto" ? "auto" : dbView);

  const rowsHaveCover = !!data.rowCovers && rows.some((r) => data.rowCovers?.has(r.id));
  if (resolvedView === "auto" && data.inColumnList && rows.length <= 8 && !rowsHaveCover) {
    return renderCompactList(data, rows, schema, resolveLink);
  }

  if (resolvedView === "calendar") {
    return renderCalendarView(
      data,
      rows,
      schema,
      header,
      filterStrip,
      view?.datePropertyName,
      resolveLink,
      view?.visibleProps,
    );
  }
  if (resolvedView === "timeline") {
    return renderTimelineView(
      data,
      rows,
      schema,
      header,
      filterStrip,
      view?.datePropertyName,
      view?.endDatePropertyName,
      resolveLink,
      view?.visibleProps,
    );
  }
  if (resolvedView === "list") {
    return renderListView(data, rows, schema, header, filterStrip, resolveLink, view?.visibleProps);
  }

  if (resolvedView === "kanban") {
    if (!resolvedGroupKey) {
      // No status/select column — log to stderr but still render a single-col
      // board so the explicit override has a visible effect.
      // eslint-disable-next-line no-console
      console.warn(
        `notion-exporter: view=kanban but DB "${data.title}" has no status/select column; falling back to "No status" group`,
      );
    }
    return renderKanbanView(
      data,
      rows,
      schema,
      header,
      filterStrip,
      resolvedGroupKey,
      resolveLink,
      config,
      view,
    );
  }
  if (resolvedView === "gallery") {
    return renderGalleryView(data, rows, schema, header, resolveLink, filterStrip);
  }
  if (resolvedView === "auto") {
    const useKanban = resolvedGroupKey !== null && isKanbanShape(rows, resolvedGroupKey);
    if (useKanban) {
      return renderKanbanView(
        data,
        rows,
        schema,
        header,
        filterStrip,
        resolvedGroupKey,
        resolveLink,
        config,
        view,
      );
    }
    const withCover = data.rowCovers && rows.some((r) => data.rowCovers?.has(r.id));
    if (withCover) return renderGalleryView(data, rows, schema, header, resolveLink, filterStrip);
    return renderTableView(
      data,
      rows,
      schema,
      header,
      resolveLink,
      filterStrip,
      view?.visibleProps,
    );
  }
  // resolvedView === "table"
  return renderTableView(data, rows, schema, header, resolveLink, filterStrip, view?.visibleProps);
}

let _vtCounter = 0;
/** Stable-per-call unique suffix for a tabbed DB's radio group, so multiple
 * tabbed DBs on one page don't share `name`/`id`. */
function vtabId(): string {
  _vtCounter = (_vtCounter + 1) & 0xffff;
  return _vtCounter.toString(36);
}

/** Render a database with one or more views as CSS-only radio tabs: a chip per
 * view (labelled with the view name), each switching a full `renderSingleView`
 * panel. The first view is checked by default. Works offline with zero JS —
 * the stylesheet's `:checked ~` rules (capped at MAX_VIEWS) reveal the active
 * panel. (View names are attribute-escaped; unicode emoji pass through, but
 * `:slug:` custom emoji aren't resolved here — no emoji map at this layer.) */
function renderTabbedViews(
  data: ChildDatabaseData,
  views: ViewWithOrder[],
  schema: Record<string, { type?: string }>,
  config: DbViewConfig,
  dbView: "auto" | "table" | "kanban",
  resolveLink?: ResolveLink,
  log?: Logger,
): string {
  const gid = vtabId();
  const radios = views
    .map(
      (_e, i) =>
        `<input type="radio" class="view-tab-radio" name="vt-${gid}" id="vt-${gid}-${i}"${i === 0 ? " checked" : ""}>`,
    )
    .join("");
  const tabs = views
    .map((e, i) => {
      const name = e.view.name?.trim() || `View ${i + 1}`;
      return `<label class="view-tab" for="vt-${gid}-${i}">${escapeHtmlText(name)}</label>`;
    })
    .join("");
  const panels = views
    .map(
      (e, i) =>
        `<div class="view-panel" data-view-index="${i}">${renderSingleView(data, e, schema, config, dbView, resolveLink, log)}</div>`,
    )
    .join("");
  return `<div class="inline-db-tabbed">${radios}<div class="view-tabs" role="tablist">${tabs}</div><div class="view-panels">${panels}</div></div>`;
}

/** Renderer keys `renderInlineDatabase` can resolve to. `calendar`/`timeline`/
 * `list` are only reachable via a captured primary view. */
type ResolvedView = "kanban" | "table" | "gallery" | "calendar" | "timeline" | "list" | "auto";

/**
 * Map a Notion view layout type to the renderer that draws it. Returns `null`
 * when no view was captured (fall through to fence / CLI / heuristic).
 *
 * `board` → kanban; `gallery`/`table`/`list` map to their own renderers. The
 * non-row layouts we don't draw natively (`form`/`chart`/`map`/`dashboard`)
 * degrade to the table renderer — the rows are still fully exported, just
 * without that layout's chrome.
 */
function viewRendererType(view: ViewSchema | undefined): ResolvedView | null {
  if (!view) return null;
  switch (view.type) {
    case "board":
      return "kanban";
    case "gallery":
      return "gallery";
    case "calendar":
      return "calendar";
    case "timeline":
      return "timeline";
    case "list":
      return "list";
    case "table":
      return "table";
    default:
      return "table"; // form / chart / map / dashboard → tabular fallback
  }
}
