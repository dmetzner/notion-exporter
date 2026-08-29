// Shared helpers for the per-layout inline-database renderers (kanban, table,
// gallery, calendar, timeline, list, compact). Column ordering (incl. the
// `rankColumn` 5-tier precedence cascade — invariant #12), filter-strip
// widgets, the `data-filter-*` attribute emitter, group-key resolution, and the
// date utilities used by calendar/timeline all live here.

import type { Logger } from "../../../logger.js";
import type { DataSourceSchema } from "../../../notion/dataSourceSchema.js";
import type { DbViewConfig } from "../../dbConfig.js";
import { renderPropertyValue, rowTitle } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl, statusRankOf } from "../util.js";

/**
 * Reorder + filter rows to match the primary view's exact presentation order.
 * `rowOrder` is the flat, filtered, sorted (and for boards, group-ordered)
 * list of page ids from the View Query API. Rows whose id is absent are hidden
 * (filtered out by the view).
 *
 * No-op when `rowOrder` is absent. Defensive: if the intersection is empty
 * (e.g. an id mismatch, or a view that legitimately filters everything out)
 * the original rows are returned rather than rendering a blank database.
 */
export function applyViewOrder(rows: DatabaseRow[], rowOrder?: string[]): DatabaseRow[] {
  if (!rowOrder || rowOrder.length === 0) return rows;
  const rank = new Map<string, number>();
  rowOrder.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const kept = rows.filter((r) => rank.has(r.id));
  if (kept.length === 0) return rows;
  return kept.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/** True when `name` is a status/select column present in `schema` — the only
 * column types the kanban renderer can bucket by today. */
function isGroupableColumn(schema: Record<string, { type?: string }>, name: string): boolean {
  const col = schema[name];
  return !!col && (col.type === "status" || col.type === "select");
}

/**
 * Resolve the kanban group column. Precedence:
 *   1. Operator `groupBy` fence — honored when it names an existing
 *      status/select column; otherwise warn and continue.
 *   2. The primary view's `group_by` property — when it is a status/select
 *      column we can bucket by (boards grouping by people/date/etc. fall
 *      through; the renderer doesn't draw those layouts).
 *   3. `pickKanbanGroupKey` auto-heuristic.
 */
export function resolveGroupKey(
  config: DbViewConfig,
  schema: Record<string, { type?: string }>,
  autoGroupKey: string | null,
  dbTitle: string,
  log: Logger | undefined,
  viewGroupBy?: string,
): string | null {
  const name = config.groupBy;
  if (name) {
    if (isGroupableColumn(schema, name)) return name;
    log?.warn(
      { dbTitle, groupBy: name, type: schema[name]?.type },
      `notion-exporter: groupBy='${name}' is not a status/select column; falling back to view/auto`,
    );
  }
  if (viewGroupBy && isGroupableColumn(schema, viewGroupBy)) return viewGroupBy;
  return autoGroupKey;
}

/** Pick the column suitable for kanban grouping. Prefers `status` (Notion's
 * canonical kanban grouping property) over `select`. Returns `null` when no
 * status/select column exists; with multiple `select` columns and no `status`
 * we also bail (ambiguous).
 *
 * When a `dataSource` schema is present we use it as the FIRST source of
 * truth — Notion's persisted schema beats both `inferSchema` and row
 * inference. Falls back to the legacy paths when the schema is absent
 * (older raw JSON written before the data-source phase shipped). */
export function pickKanbanGroupKey(
  schema: Record<string, { type?: string }>,
  rows: DatabaseRow[],
  dataSource?: DataSourceSchema,
): string | null {
  // SECURITY: ignore malformed `dataSource.properties` blobs (e.g.
  // operator-edited raw JSON where `properties` was stringified or
  // nulled) — falling through to the schema/row heuristic is safe.
  if (
    dataSource?.properties &&
    typeof dataSource.properties === "object" &&
    !Array.isArray(dataSource.properties)
  ) {
    const entries = Object.entries(dataSource.properties).map(
      ([k, v]) => [k, { type: v?.type }] as [string, { type?: string }],
    );
    const fromDS = pickFromTypedEntries(entries);
    if (fromDS) return fromDS;
  }
  const fromSchemaResult = pickFromTypedEntries(Object.entries(schema));
  if (fromSchemaResult) return fromSchemaResult;
  const first = rows[0]?.properties;
  if (!first) return null;
  return pickFromTypedEntries(
    Object.entries(first).map(([k, v]) => [k, { type: (v as { type?: string })?.type }]),
  );
}

function pickFromTypedEntries(entries: Array<[string, { type?: string }]>): string | null {
  const status = entries.filter(([, v]) => v?.type === "status").map(([k]) => k);
  if (status.length === 1) return status[0] ?? null;
  if (status.length > 1) return null; // ambiguous: bail
  const select = entries.filter(([, v]) => v?.type === "select").map(([k]) => k);
  if (select.length === 1) return select[0] ?? null;
  return null;
}

/** Read the value of a status/select cell as the bucket name (empty → ""). */
export function groupValueOf(row: DatabaseRow, key: string): string {
  const p = row.properties?.[key] as
    | { type?: string; select?: { name?: string }; status?: { name?: string } }
    | undefined;
  if (!p) return "";
  if (p.type === "status") return p.status?.name ?? "";
  if (p.type === "select") return p.select?.name ?? "";
  return "";
}

/** Kanban heuristic — 2–12 unique non-empty buckets, ≥80% populated, ≥3 rows. */
export function isKanbanShape(rows: DatabaseRow[], groupKey: string): boolean {
  if (rows.length < 3) return false;
  const buckets = new Set<string>();
  let populated = 0;
  for (const row of rows) {
    const v = groupValueOf(row, groupKey);
    if (v) {
      buckets.add(v);
      populated += 1;
    }
  }
  if (buckets.size < 2 || buckets.size > 12) return false;
  return populated / rows.length >= 0.8;
}

/** Emit the chip / date / number-range filter widgets above the inline-db
 * header. Each widget carries `data-filter-col` (the column name) and
 * `data-filter-type` so the client JS can pick them up without re-deriving
 * schema. */
export function renderFilterStrip(
  schema: Record<string, { type?: string }>,
  rows: DatabaseRow[],
  dataSource?: DataSourceSchema,
): string {
  const cols = Object.keys(schema);
  if (cols.length <= 1 || rows.length === 0) return "";
  const widgets: string[] = [];
  // Track sortable columns for the dropdown — title/number/date/status/select.
  const sortable: string[] = [];

  for (const col of cols) {
    const t = schema[col]?.type;
    if (t === "title" || t === "number" || t === "date" || t === "status" || t === "select") {
      sortable.push(col);
    }
    if (t === "select" || t === "status" || t === "multi_select") {
      const options = uniqueOptions(rows, col, t, dataSource);
      if (options.length === 0) continue;
      const chips = options
        .map(
          (opt) =>
            `<button type="button" class="db-filter-chip" data-filter-value="${escapeHtmlText(opt)}">${escapeHtmlText(opt)}</button>`,
        )
        .join("");
      widgets.push(
        `<div class="db-filter-group" data-filter-col="${escapeHtmlText(col)}" data-filter-type="select"><span class="db-filter-label">${escapeHtmlText(col)}</span><div class="db-filter-chips">${chips}</div></div>`,
      );
    } else if (t === "date") {
      widgets.push(
        `<div class="db-filter-group" data-filter-col="${escapeHtmlText(col)}" data-filter-type="date"><span class="db-filter-label">${escapeHtmlText(col)}</span><input type="date" class="db-filter-date db-filter-from" data-filter-bound="from" aria-label="${escapeHtmlText(col)} from"><span class="db-filter-sep">→</span><input type="date" class="db-filter-date db-filter-to" data-filter-bound="to" aria-label="${escapeHtmlText(col)} to"></div>`,
      );
    } else if (t === "number") {
      widgets.push(
        `<div class="db-filter-group" data-filter-col="${escapeHtmlText(col)}" data-filter-type="number"><span class="db-filter-label">${escapeHtmlText(col)}</span><input type="number" class="db-filter-num db-filter-from" data-filter-bound="from" placeholder="min" aria-label="${escapeHtmlText(col)} min"><span class="db-filter-sep">–</span><input type="number" class="db-filter-num db-filter-to" data-filter-bound="to" placeholder="max" aria-label="${escapeHtmlText(col)} max"></div>`,
      );
    }
  }

  const sortDropdown =
    sortable.length >= 2
      ? `<div class="db-filter-sort"><label class="db-filter-label" for="db-filter-sort-${idStub()}">Sort</label><select class="db-filter-sort-select" data-filter-sort><option value="">(default)</option>${sortable
          .map(
            (c) =>
              `<option value="${escapeHtmlText(c)}:asc">${escapeHtmlText(c)} ↑</option><option value="${escapeHtmlText(c)}:desc">${escapeHtmlText(c)} ↓</option>`,
          )
          .join("")}</select></div>`
      : "";

  if (widgets.length === 0 && !sortDropdown) return "";

  const clearBtn = `<button type="button" class="db-filter-clear" data-filter-clear hidden>Clear filters</button>`;
  // Filter strip is collapsed-by-default to save vertical space. The summary
  // shows row count + a "Filters" affordance; click to expand the chip/range
  // widgets. Empty databases never get a strip (see early returns above).
  const widgetCount = widgets.length + (sortDropdown ? 1 : 0);
  return `<details class="db-filters-wrap"><summary class="db-filters-toggle"><span class="db-filters-toggle-icon" aria-hidden="true"></span><span class="db-filters-toggle-label">Filter &amp; sort</span><span class="db-filters-toggle-count">${widgetCount}</span></summary><div class="db-filters" data-db-filters>${widgets.join("")}${sortDropdown}${clearBtn}</div></details>`;
}

let _idCounter = 0;
function idStub(): string {
  _idCounter = (_idCounter + 1) & 0xffff;
  return `f${_idCounter.toString(36)}`;
}

/** Distinct option names appearing in the given column across rows.
 *
 * When `dataSource` carries an options list for this column, emit options
 * in workspace order rather than first-occurrence-from-rows. Options that
 * exist in rows but are missing from the schema (archived options) sort
 * after the schema-known ones, alphabetically. Without a schema we fall
 * back to the legacy alphabetical sort. */
function uniqueOptions(
  rows: DatabaseRow[],
  col: string,
  kind: string,
  dataSource?: DataSourceSchema,
): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const p = row.properties?.[col] as
      | {
          select?: { name?: string };
          status?: { name?: string };
          multi_select?: Array<{ name?: string }>;
        }
      | undefined;
    if (!p) continue;
    if (kind === "select" && p.select?.name) out.add(p.select.name);
    else if (kind === "status" && p.status?.name) out.add(p.status.name);
    else if (kind === "multi_select") {
      for (const opt of p.multi_select ?? []) {
        if (opt?.name) out.add(opt.name);
      }
    }
  }
  const dsOptions = dataSourceOptionNames(dataSource, col);
  if (dsOptions) {
    // Build a Set once instead of an O(N) `.includes()` per row — the
    // surrounding renderFilterStrip / kanban loops fire this for every
    // select/status/multi_select column across hundreds of inline DBs.
    const dsOptionSet = new Set(dsOptions);
    const known: string[] = [];
    for (const name of dsOptions) if (out.has(name)) known.push(name);
    const unknown = [...out].filter((n) => !dsOptionSet.has(n)).sort();
    return [...known, ...unknown];
  }
  // When no dataSource ordering is available, status-typed columns should
  // still emit chips in the same order the kanban columns use (STATUS_RANK),
  // so users don't see "[In progress] [Not started]" chips above a
  // "Not started → In progress" board. Non-status columns keep the legacy
  // alphabetic sort.
  if (kind === "status") {
    return [...out].sort((a, b) => {
      const ra = statusRankOf(a);
      const rb = statusRankOf(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
  }
  return [...out].sort();
}

/** Read the option list for a status/select/multi_select column from the
 * persisted data-source schema. Returns names in Notion workspace order,
 * or `null` when the schema is absent or doesn't carry options for `col`. */
export function dataSourceOptionNames(
  dataSource: DataSourceSchema | undefined,
  col: string,
): string[] | null {
  if (!dataSource) return null;
  // SECURITY: tampered raw JSON may have non-object `properties`. Reject
  // silently — the renderer falls back to the legacy STATUS_RANK +
  // first-occurrence heuristic.
  if (
    !dataSource.properties ||
    typeof dataSource.properties !== "object" ||
    Array.isArray(dataSource.properties)
  ) {
    return null;
  }
  const prop = dataSource.properties[col];
  if (!prop) return null;
  const opts = prop.status?.options ?? prop.select?.options ?? prop.multi_select?.options ?? null;
  if (!Array.isArray(opts) || opts.length === 0) return null;
  // Filter to string names only — non-string option names cannot reach the
  // HTML sink anyway (Set.has gates them out downstream) but a `.map(o => o.name)`
  // pass through TypeError-prone shapes is risk we don't need.
  const names = opts.filter((o) => typeof o?.name === "string").map((o) => o.name);
  if (names.length === 0) return null;
  return names;
}

/** Build a `name → rank` map for column ordering driven by the data-source
 * schema. Returns `null` when no schema/options exist. */
export function dataSourceOptionRank(
  dataSource: DataSourceSchema | undefined,
  col: string,
): Map<string, number> | null {
  const names = dataSourceOptionNames(dataSource, col);
  if (!names) return null;
  return new Map(names.map((n, i) => [n, i] as const));
}

export const NO_STATUS = "No status";

/**
 * Rank a kanban column name against the precedence cascade so the comparator
 * collapses to a single subtraction.
 *
 * Tiers (lower wins, ties handled by next tier):
 *   1. `configRank`     — operator-defined `order` from `%%notion-exporter`.
 *                         Absolute override; wins outright.
 *   2. `viewRank`       — the primary view's exact (incl. manual) column order,
 *                         derived from first-occurrence over the View Query
 *                         API's group-ordered results. Ground truth from the
 *                         workspace; beats every heuristic below.
 *   3. `dataSourceRank` — Notion workspace's persisted option order.
 *   4. `STATUS_RANK`    — legacy heuristic (backlog → wip → done, EN+DE).
 *   5. tier-5 floor     — unknown name (stable insertion-order tie).
 *
 * "No status" is always pinned at the very end (`+Infinity`), matching
 * Notion's own behaviour for unfilled status cells. Unknown names use the
 * finite tier-5 floor instead of `+Infinity` so a stable-sort tie with
 * NO_STATUS can't leave NO_STATUS ahead of an unknown bucket.
 *
 * Each tier is encoded as a band so a higher-tier hit always beats a
 * lower-tier hit regardless of subrank: tier 1 lives in `[0, 1e6)`, tier 2 in
 * `[1e6, 2e6)`, tier 3 in `[2e6, 3e6)`, tier 4 in `[3e6, 4e6)`, tier 5 at
 * `4e6`. Subranks within a tier are direct positions from the source map
 * (typically 0..N for small N), well below the 1e6 ceiling that separates
 * tiers.
 */
export function rankColumn(
  name: string,
  configRank: Map<string, number> | null,
  viewRank: Map<string, number> | null,
  dataSourceRank: Map<string, number> | null,
): number {
  if (name === NO_STATUS) return Number.POSITIVE_INFINITY;
  const cfg = configRank?.get(name);
  if (cfg !== undefined) return cfg;
  const vw = viewRank?.get(name);
  if (vw !== undefined) return 1_000_000 + vw;
  const ds = dataSourceRank?.get(name);
  if (ds !== undefined) return 2_000_000 + ds;
  const status = statusRankOf(name);
  if (status !== Number.POSITIVE_INFINITY) return 3_000_000 + status;
  // Unknown names park at the tier-5 floor (4e6) so NO_STATUS's +Infinity is
  // strictly greater and stays last even under a stable-sort tie.
  return 4_000_000;
}

/** Build a `groupValue → position` map from the first time each non-empty
 * bucket value appears across `rows`. When `rows` are in the primary view's
 * group-ordered presentation order, this is the view's exact (incl. manual)
 * column order. Empty values (→ NO_STATUS) are skipped; NO_STATUS is pinned
 * last by `rankColumn` regardless. */
export function firstOccurrenceRank(rows: DatabaseRow[], groupKey: string): Map<string, number> {
  const rank = new Map<string, number>();
  for (const row of rows) {
    const v = groupValueOf(row, groupKey);
    if (v && !rank.has(v)) rank.set(v, rank.size);
  }
  return rank;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export { MONTH_NAMES, WEEKDAY_NAMES };

/** Read a date property's start as `YYYY-MM-DD` (ISO times are truncated). */
export function dateStartOf(row: DatabaseRow, key: string): string | undefined {
  const p = row.properties?.[key] as { date?: { start?: string } } | undefined;
  const s = p?.date?.start;
  return typeof s === "string" ? s.slice(0, 10) : undefined;
}

/** Read a date property's range end as `YYYY-MM-DD`. */
export function dateEndOf(row: DatabaseRow, key: string): string | undefined {
  const p = row.properties?.[key] as { date?: { end?: string } } | undefined;
  const e = p?.date?.end;
  return typeof e === "string" ? e.slice(0, 10) : undefined;
}

/** `YYYY-MM-DD` → integer UTC epoch-day, or `NaN`. Deterministic (no clock). */
export function epochDay(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return Number.NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Pick the date column to drive a calendar/timeline: the view's named date
 * property when it exists in the schema, else the first `date`-typed column. */
export function pickDateKey(
  schema: Record<string, { type?: string }>,
  preferred: string | undefined,
): string | undefined {
  if (preferred && schema[preferred]?.type === "date") return preferred;
  return Object.keys(schema).find((k) => schema[k]?.type === "date");
}

/** Collapsible list of rows with no usable date — appended below a
 * calendar/timeline so they aren't silently dropped. */
export function renderUndatedList(
  rows: DatabaseRow[],
  data: ChildDatabaseData,
  schema: Record<string, { type?: string }>,
  label: string,
): string {
  if (rows.length === 0) return "";
  const items = rows
    .map((row) => {
      const href = data.rowHrefs?.get(row.id);
      const t = rowTitle(row, schema);
      return href ? `<li><a href="${mdUrl(href)}">${t}</a></li>` : `<li>${t}</li>`;
    })
    .join("");
  return `<details class="db-undated"><summary>${escapeHtmlText(label)} (${rows.length})</summary><ul class="db-undated-list">${items}</ul></details>`;
}

/** Pick up to 2 most-distinctive properties for a compact-row meta line.
 * Mirrors the kanban-card heuristic: date / select / status / multi_select /
 * number first, skipping the title and chrome-only columns (created_time,
 * last_edited_time, *_by). */
export function pickCompactRowMeta(
  row: DatabaseRow,
  schema: Record<string, { type?: string }>,
  titleKey: string | undefined,
  resolveLink?: ResolveLink,
): string {
  const skip = new Set(["created_time", "last_edited_time", "created_by", "last_edited_by"]);
  const preferred = ["date", "status", "select", "multi_select", "number"];
  const bits: string[] = [];
  for (const t of preferred) {
    if (bits.length >= 2) break;
    for (const k of Object.keys(schema)) {
      if (bits.length >= 2) break;
      if (k === titleKey) continue;
      if (skip.has(schema[k]?.type ?? "")) continue;
      if (schema[k]?.type !== t) continue;
      const v = renderPropertyValue(row.properties?.[k], resolveLink);
      if (!v) continue;
      bits.push(v);
    }
  }
  return bits.join(" ");
}

/** Emit `data-filter-*` attributes the client JS uses to evaluate filters
 * without re-parsing cell HTML. Returns a leading space-prefixed string so it
 * can be concatenated directly into the opening `<td …>` tag. */
export function filterDataAttrs(value: unknown, type: string | undefined): string {
  if (!value) return "";
  const p = value as {
    type?: string;
    select?: { name?: string };
    status?: { name?: string };
    multi_select?: Array<{ name?: string }>;
    date?: { start?: string; end?: string };
    number?: number;
  };
  // Contract with `SEARCH_JS#matchSelect` (clientAssets.ts): every option
  // name (select / status / multi_select) is `encodeURIComponent`-encoded
  // before joining with `|`. The client `split('|')` + `decodeURIComponent`s
  // each piece unconditionally. Encoding select/status the same way keeps the
  // one client decode path correct for all three types — and protects names
  // that contain a literal `|` (e.g. "Priority|High", "Blocked|Waiting")
  // from being split into two false-matchable values. The chip's
  // `data-filter-value` attribute (see `renderFilterStrip` and the test
  // below) carries the raw human-readable name; the client compares
  // decoded(`data-filter-values` pieces) against the raw `data-filter-value`,
  // so they line up.
  if (type === "select" && p.select?.name) {
    return ` data-filter-values="${escapeHtmlText(encodeURIComponent(p.select.name))}"`;
  }
  if (type === "status" && p.status?.name) {
    return ` data-filter-values="${escapeHtmlText(encodeURIComponent(p.status.name))}"`;
  }
  if (type === "multi_select") {
    const names = (p.multi_select ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string");
    if (!names.length) return "";
    const joined = names.map((n) => encodeURIComponent(n)).join("|");
    return ` data-filter-values="${escapeHtmlText(joined)}"`;
  }
  if (type === "date" && p.date?.start) {
    const end = p.date.end ? ` data-filter-date-end="${escapeHtmlText(p.date.end)}"` : "";
    return ` data-filter-date="${escapeHtmlText(p.date.start)}"${end}`;
  }
  if (type === "number" && typeof p.number === "number") {
    return ` data-filter-number="${p.number}"`;
  }
  return "";
}
