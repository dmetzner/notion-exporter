# Database views and column order

Answers: "in what order do kanban columns and filter chips come out, and how does a Notion
view become a rendered tab?"

Both are load-bearing: breaking either silently reorders every board in an export, or drops a
linked view back to the empty stub it used to be.

## Column order is a five-tier precedence chain
Defined in `rankColumn` (`src/export/markdown/database.ts`). Whenever a
renderer surfaces status / select / multi-select options in a
deterministic order — kanban columns, chip filter rows, compact cards
grouped by a property — it MUST resolve order through these tiers in
order:

1. **`config.order`** — `%%notion-exporter` fence in the DB description
   (parsed by `parseDbConfig` in `src/export/dbConfig.ts`).
   Operator override; wins outright.
2. **`viewRank`** — the primary view's exact column order (incl. manual),
   derived by first-occurrence over the View Query API's group-ordered
   rows (`firstOccurrenceRank` over `data.rowOrder`-sorted rows). Ground
   truth from the workspace; built only when a view was captured (see
   invariant #13). Beats every heuristic below.
3. **`data.dataSource` option order** — canonical workspace schema
   persisted onto raw DB JSON during crawl (via
   `notion.dataSources.retrieve`; see also v5 quirk below). Shape:
   `{ id, properties: { <name>: { type, options?: [{ id, name, color }] } } }`
   persisted as a top-level field on every raw DB JSON.
   `commands/rerender.ts` carries it forward on the clone path and
   counts `dbsWithSchema` for telemetry; legacy exports written before
   the schema-capture pass simply lack the field and fall through
   to the next tier.
4. **`STATUS_RANK`** — built-in workflow rank for well-known status
   names (`Backlog` / `Todo` / `In progress` / `Done` / …) defined in
   `src/export/markdown/util.ts`. Used only when none of config / view /
   schema is available.
5. **First-occurrence** — stable insertion order from the row set.
   Last-resort tie-break; never reordered after the first pass.

`rankColumn(name, configRank, viewRank, dataSourceRank)` encodes the
cascade as a banded numeric (tier N in `[(N-1)·1e6, N·1e6)`) so the
comparator is a single subtraction. **`viewRank` is built ONLY when
`data.view` is present** — otherwise first-occurrence over fetch order
would masquerade as a workspace-ordered tier and silently override the
dataSource/STATUS heuristics.

**"No status" is always anchored last**, regardless of which tier
resolved the rest. Do not move it into the rank table during a
refactor — it is a catch-all, not a workflow stage. Dropping the
`dataSource` field during a refactor of `rerender` or the kanban
renderer will silently reorder kanban boards on every legacy-shaped
export that has the field set; that is a regression, not a
simplification.

## Views drive layout; heuristics are the fallback

ALL of a DB's views
are captured from the GA Views API (`fetchAllViews`, `src/notion/views.ts`),
in Notion tab order: `views.list` (paginated) → per view `views.retrieve`
(normalized to the compact `ViewSchema`: layout `type`, `name`,
`dataSourceId`, `groupByName`, date props, ordered `visibleProps`) →
`views.queries.create` + paginated `views.queries.results` → a flat,
filtered, sorted, group-ordered list of page ids (`rowOrder`). Persisted as
a top-level `views: [{view, rowOrder}]` array on raw DB JSON, **next to
`dataSource`**, and carried forward by `rerender`/`repair` through
`normalizeViews` — which validates each entry (operator-untrusted read
seam, same contract as `validateDataSourceSchema`) AND accepts the legacy
single `view`/`rowOrder` shape from pre-multi-view exports (→ one-element
array). Query handles expire server-side, so we persist the *resolved*
`rowOrder`s, not the handle — rerender reproduces order with **zero** API
calls (invariant #7). Top-level `rows` is the union of every view's rows
(for linked-view rescue, the source rows filtered to the union of all
views' `rowOrder`s); each view re-filters via `applyViewOrder` at render.
Capture is capped at `MAX_VIEWS` (16) per DB.

In the renderer (`renderInlineDatabase`): with ≥1 captured view it emits a
**tabbed** section (`renderTabbedViews`) — CSS-only radio tabs (no JS, no
new client asset → invariant #10 untouched), one chip per view labelled
with the view `name`, the first checked; each tab is a full
`renderSingleView` panel. The stylesheet's `nth-of-type(k):checked ~ …
nth-child(k)` rules (also capped at 16) reveal the active panel. With no
captured view it falls back to the single heuristic render. Per view:
`view.type` selects the layout (tier-0, above the `dbView` CLI param and
the `isKanbanShape` heuristic, but below the `config.view` fence),
`applyViewOrder` filters + reorders rows, `groupByName` picks the kanban
group key, `visibleProps` drives table columns + card meta. `board`→kanban,
`calendar`/`timeline`/`list` get dedicated renderers, `gallery`/`table`
map directly; the non-row layouts `form`/`chart`/`map`/`dashboard` degrade
to the table renderer (rows still fully exported). Calendar/timeline/list
+ tab CSS all live in `STYLE_CSS`. **Notion-Version:** the SDK default
(`2025-09-03`) is what we send; if a future `views.retrieve` returns a
null/sparse `configuration`, `toViewSchema` returns null and the renderer
falls back to heuristics (degrades safely) — bump `notionVersion` in
`client.ts` only after confirming the config shape against a live
workspace.

**Linked-view rescue.** A Notion "linked view of database" is exposed as a
`child_database` block whose own retrieve is an empty stub
(`data_sources: []`, zero rows) — historically unrecoverable. The Views API
fixes this: the view object carries a `data_source_id` (captured as
`ViewSchema.dataSourceId`) pointing at the real source. When a DB's own
`data_sources` is empty but the view names a source, `exportAllJson`
(`json.ts`) queries it via `queryDataSourceRows`, keeps only the rows the
view shows (`filterRowsToOrder` against `rowOrder`), and hydrates the
source schema. The incremental `backfillSkippedDatabaseViews`
(`commands/export.ts`) does the same for cloned stubs — and localizes the
resolved rows' cover/icon media — so a normal `pnpm dev export` rescues
them with **no `--force`**. Source row queries are cached per
`data_source_id` (many "Ansicht: …" views share one source). The legacy
same-page-source aliasing (`resolveLinkedDbStubs`, `pipeline.ts`) remains
the fallback for stubs the Views API can't resolve.
