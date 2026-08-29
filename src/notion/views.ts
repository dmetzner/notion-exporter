import type { Logger } from "../logger.js";
import type { RateLimitedNotion } from "./client.js";

/**
 * Normalized, renderer-facing projection of a Notion *view* (the GA Views API,
 * `notion.views.*`). A view is the workspace's own answer to questions this
 * exporter used to guess at: which layout, which property to group by, which
 * columns are visible, in what order rows appear. Capturing it turns those
 * heuristics (STATUS_RANK, isKanbanShape, cardMeta) into fallbacks.
 *
 * We persist this compact shape (not the raw SDK response) on the database raw
 * JSON. The SDK's `DataSourceViewObjectResponse` is large and its typings are
 * still settling; normalizing at capture time keeps the renderer — and the
 * rerender read seam — decoupled from that churn. The full response is
 * recoverable from Notion on demand; what the renderer needs is small.
 *
 * Property *names* (not ids) are captured because the rest of the renderer keys
 * rows and schema by property name. When the API omits a `property_name` (it is
 * optional in the response) the corresponding field is left undefined and the
 * renderer falls back to its heuristic path for that facet.
 */
export interface ViewSchema {
  id: string;
  /** Layout: `table | board | calendar | timeline | gallery | list | form |
   * chart | map | dashboard`. Drives renderer selection (tier-0). */
  type: string;
  name?: string;
  /** The data source this view reads from. For a *linked* view this points at
   * the source database the inline block's own stub (`data_sources: []`)
   * hides — the only way to recover its rows. `undefined` for ordinary views
   * whose rows come from the database's own data source. */
  dataSourceId?: string;
  /** Group-by property name (board kanban columns; optionally table). */
  groupByName?: string;
  /** Date property name — calendar day bucketing, timeline bar start. */
  datePropertyName?: string;
  /** Timeline bar end (range). Absent → timeline degrades to a sorted table. */
  endDatePropertyName?: string;
  /** Visible property names in display order — drives table columns / card meta. */
  visibleProps?: string[];
}

/** Layout types this exporter renders natively. Everything else degrades. */
const KNOWN_VIEW_TYPES = new Set([
  "table",
  "board",
  "calendar",
  "timeline",
  "gallery",
  "list",
  "form",
  "chart",
  "map",
  "dashboard",
]);

interface RawGroupBy {
  property_id?: unknown;
  property_name?: unknown;
}

interface RawViewProperty {
  property_id?: unknown;
  property_name?: unknown;
  visible?: unknown;
}

interface RawViewConfig {
  group_by?: RawGroupBy;
  date_property_name?: unknown;
  end_date_property_name?: unknown;
  properties?: unknown;
}

interface RawView {
  object?: unknown;
  id?: unknown;
  type?: unknown;
  name?: unknown;
  data_source_id?: unknown;
  configuration?: RawViewConfig | null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Project a raw `views.retrieve` response into the compact `ViewSchema`.
 *
 * Returns `null` for a partial view object (the API returns only
 * `{ object, id, parent }` when the integration can't see the view's config),
 * an unknown layout type, or any non-object payload — every `null` path means
 * "fall back to heuristics".
 */
export function toViewSchema(raw: unknown, log?: Logger): ViewSchema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as RawView;
  const id = str(v.id);
  const type = str(v.type);
  if (!id || !type) return null; // partial view object — no usable config
  if (!KNOWN_VIEW_TYPES.has(type)) {
    log?.info({ id, type }, "view: unknown layout type; renderer will fall back");
    return null;
  }
  const cfg = v.configuration ?? undefined;
  const groupByName = str(cfg?.group_by?.property_name);
  const datePropertyName = str(cfg?.date_property_name);
  const endDatePropertyName = str(cfg?.end_date_property_name);
  let visibleProps: string[] | undefined;
  if (Array.isArray(cfg?.properties)) {
    const names: string[] = [];
    for (const p of cfg.properties as RawViewProperty[]) {
      if (p && p.visible !== false) {
        const name = str(p.property_name);
        if (name) names.push(name);
      }
    }
    if (names.length > 0) visibleProps = names;
  }
  return {
    id,
    type,
    ...(str(v.name) ? { name: str(v.name) } : {}),
    ...(str(v.data_source_id) ? { dataSourceId: str(v.data_source_id) } : {}),
    ...(groupByName ? { groupByName } : {}),
    ...(datePropertyName ? { datePropertyName } : {}),
    ...(endDatePropertyName ? { endDatePropertyName } : {}),
    ...(visibleProps ? { visibleProps } : {}),
  };
}

/**
 * Runtime shape gate for a `ViewSchema` rehydrated from raw JSON during
 * rerender. The raw JSON is operator-untrusted (a workspace member could
 * hand-edit it), so validate the normalized shape before threading it into the
 * renderer; a `null` return drops the view and falls back to heuristics.
 *
 * Mirrors `validateDataSourceSchema` in `dataSourceSchema.ts`.
 */
export function validateView(raw: unknown, log?: Logger): ViewSchema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    log?.info({}, "view: rejected non-object payload");
    return null;
  }
  const v = raw as Record<string, unknown>;
  const id = str(v.id);
  const type = str(v.type);
  if (!id || !type || !KNOWN_VIEW_TYPES.has(type)) {
    log?.info({ type: v.type }, "view: rejected malformed/unknown-type payload");
    return null;
  }
  const visibleProps =
    Array.isArray(v.visibleProps) && v.visibleProps.every((s) => typeof s === "string")
      ? (v.visibleProps as string[])
      : undefined;
  return {
    id,
    type,
    ...(str(v.name) ? { name: str(v.name) } : {}),
    ...(str(v.dataSourceId) ? { dataSourceId: str(v.dataSourceId) } : {}),
    ...(str(v.groupByName) ? { groupByName: str(v.groupByName) } : {}),
    ...(str(v.datePropertyName) ? { datePropertyName: str(v.datePropertyName) } : {}),
    ...(str(v.endDatePropertyName) ? { endDatePropertyName: str(v.endDatePropertyName) } : {}),
    ...(visibleProps ? { visibleProps } : {}),
  };
}

/**
 * Normalize a persisted database's view data into a validated `ViewWithOrder[]`,
 * accepting both the current `views: [{view, rowOrder}]` shape and the legacy
 * single `view` + `rowOrder` fields written before multi-view support. Each
 * view is validated (the raw JSON is operator-untrusted); invalid entries are
 * dropped. Returns `[]` when nothing usable is present → renderer heuristics.
 */
export function normalizeViews(
  raw: { views?: unknown; view?: unknown; rowOrder?: unknown },
  log?: Logger,
): ViewWithOrder[] {
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : [];
  if (Array.isArray(raw.views)) {
    const out: ViewWithOrder[] = [];
    for (const e of raw.views) {
      const entry = e as { view?: unknown; rowOrder?: unknown };
      const v = validateView(entry?.view, log);
      if (v) out.push({ view: v, rowOrder: strArr(entry?.rowOrder) });
    }
    return out;
  }
  const v = raw.view ? validateView(raw.view, log) : null;
  return v ? [{ view: v, rowOrder: strArr(raw.rowOrder) }] : [];
}

interface RawQueryPage {
  results?: unknown;
  next_cursor?: unknown;
  has_more?: unknown;
  id?: unknown; // query_id (only on create response)
  request_status?: { type?: unknown; incomplete_reason?: unknown } | null;
}

function pageIdsFrom(results: unknown): string[] {
  if (!Array.isArray(results)) return [];
  const ids: string[] = [];
  for (const r of results) {
    const id = str((r as { id?: unknown })?.id);
    if (id) ids.push(id);
  }
  return ids;
}

/** A view plus the exact order (filtered + sorted + group-ordered) its rows
 * appear in, as resolved from the View Query API. */
export interface ViewWithOrder {
  view: ViewSchema;
  rowOrder: string[];
}

/** Notion allows many views per database; we cap how many we render as tabs.
 * Beyond this we log and keep the first N (the leftmost / most-used tabs). */
const MAX_VIEWS = 16;

/** Resolve one view id → `{ view, rowOrder }`, or `null` when the view object
 * is partial/unknown. Two calls: `views.retrieve` (config) and
 * `views.queries.create` + paginated `views.queries.results` (the flat,
 * filtered, sorted, group-ordered page ids — the only source of manual
 * ordering, since the config exposes the sort *method* but not the
 * hand-arranged order; board results come back column-by-column, so
 * first-occurrence over this list yields the manual kanban column order). */
async function resolveView(
  notion: RateLimitedNotion,
  viewId: string,
  log?: Logger,
): Promise<ViewWithOrder | null> {
  const rawView = await notion.run((c) => c.views.retrieve({ view_id: viewId }));
  const view = toViewSchema(rawView, log);
  if (!view) return null;

  const rowOrder: string[] = [];
  const created = (await notion.run((c) =>
    c.views.queries.create({ view_id: viewId, page_size: 100 }),
  )) as RawQueryPage;
  const queryId = str(created.id);
  rowOrder.push(...pageIdsFrom(created.results));
  let cursor = str(created.next_cursor);
  let hasMore = created.has_more === true;
  if (created.request_status?.type === "incomplete") {
    log?.info(
      { view: view.id, reason: created.request_status.incomplete_reason },
      "view query incomplete; row order may be truncated",
    );
  }
  while (hasMore && cursor && queryId) {
    const page = (await notion.run((c) =>
      c.views.queries.results({
        view_id: viewId,
        query_id: queryId,
        start_cursor: cursor,
        page_size: 100,
      }),
    )) as RawQueryPage;
    rowOrder.push(...pageIdsFrom(page.results));
    cursor = str(page.next_cursor);
    hasMore = page.has_more === true;
  }
  return { view, rowOrder };
}

/**
 * Resolve every view of a database, in Notion's tab order (the list endpoint
 * returns them leftmost-first). Each entry carries the view config + its
 * filtered/sorted row order. Drives the tabbed multi-view renderer.
 *
 * All calls go through `RateLimitedNotion#run` (invariant #1). Best-effort:
 * returns `[]` on total failure (no views / missing capability / partial
 * responses) so the renderer falls back to heuristics. Query handles expire
 * server-side, so callers persist the resolved `rowOrder` arrays for rerender.
 */
export async function fetchAllViews(
  notion: RateLimitedNotion,
  databaseId: string,
  log?: Logger,
): Promise<ViewWithOrder[]> {
  try {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const list = await notion.run((c) =>
        c.views.list({ database_id: databaseId, start_cursor: cursor, page_size: 100 }),
      );
      for (const r of list.results ?? []) {
        const id = str((r as { id?: unknown })?.id);
        if (id) ids.push(id);
      }
      cursor = list.has_more ? str(list.next_cursor) : undefined;
    } while (cursor);

    if (ids.length > MAX_VIEWS) {
      log?.info(
        { databaseId, views: ids.length, cap: MAX_VIEWS },
        "database has more views than the render cap; keeping the first N",
      );
    }
    const out: ViewWithOrder[] = [];
    for (const id of ids.slice(0, MAX_VIEWS)) {
      const resolved = await resolveView(notion, id, log);
      if (resolved) out.push(resolved);
    }
    return out;
  } catch (err) {
    log?.warn(
      { databaseId, err: (err as Error).message },
      "view retrieve failed; renderer will fall back to heuristics",
    );
    return [];
  }
}
