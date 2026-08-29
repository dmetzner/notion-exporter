# notion-exporter — guide for Claude Code

Day-1 briefing. Captures invariants and gotchas not obvious from any single
file. Skim before changing `src/`.

## Stack

Node ≥ 22.19 (undici 8 floor), TypeScript strict, ESM-only. pnpm. Vitest (unit + snapshot;
integration tests mock `@notionhq/client`). Biome 2.x for lint + format (no
Prettier, no ESLint). tsup → single `dist/cli.js` bin.

## Commands

```bash
pnpm dev <verb>   # tsx; verb = check|export|rerender|repair
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm build        # tsup → dist/cli.js
pnpm check        # lint + typecheck + test + contrast (CI mirror; canonical pre-commit gate)
```

CLI has **four verbs** (`src/cli.ts`):

| Verb       | Use when                                                                             |
|------------|--------------------------------------------------------------------------------------|
| `check`    | Smoke-test `NOTION_TOKEN` + report visible objects. No writes.                       |
| `export`   | Full or incremental backup → `OUT_DIR/<timestamp>/`. `--force` for clean run.        |
| `rerender` | Regenerate md/html/sitemap/search from existing raw JSON. No API calls.              |
| `repair`   | Retry failed assets in the most recent export (re-signs expired Notion S3 URLs).     |

`export` defaults: **incremental ON, resume ON**. `--no-incremental` /
`--no-resume` disable; `--force` flips both off.

## Architectural invariants

Load-bearing. Breaking any of them silently corrupts exports.

1. **All Notion API calls go through `RateLimitedNotion#run`**
   (`src/notion/client.ts`). The Bottleneck limiter and 429/5xx retry with
   `Retry-After` honour are wired there. Calling `new Client(...)` directly
   skips the limiter and backoff.

2. **Asset URLs from Notion expire (~1 h).** Always download via the asset
   collector (`src/export/assets.ts#createAssetCollector`); never store the
   raw URL. On 401/403/410 the collector invokes the caller's `refresh`
   callback (usually `notion.pages.retrieve` / `notion.blocks.retrieve`) to
   mint a fresh signed URL. `repair` exists specifically to retry this
   against the most recent export, mutating raw JSON in place so subsequent
   rerenders pick up the new `local_path`.

3. **The Markdown renderer is hand-rolled** (`src/export/markdown.ts`). Do
   **not** add `notion-to-md`. Extend the renderer for new block types and
   keep output deterministic — snapshot tests under
   `test/__snapshots__/markdown.snapshot.test.ts.snap` are the gate.

4. **Custom emoji shortcodes (`:slug:`) render as `<img class="custom-emoji">`.**
   Notion ships them as a separate `plain_text` run plus a `custom_emoji`
   mention. Titles passed to sidebar entries, breadcrumbs and child-page
   links must go through `enrichTitle` (`src/commands/rerender.ts`) — or the
   equivalent inline emoji swap in `commands/export.ts` — *before* emission,
   or the literal `:slug:` text leaks into the rendered nav.

5. **Sidebar HTML is shared across every page.** `injectSidebars`
   (`src/export/html.ts`) builds one nav tree and stamps it into every HTML
   file with depth-correct `../` prefixes. Custom-emoji `<img>` tags in the
   nav use **root-relative** `src="assets/<hash>.png"`, which
   `injectSidebars` rewrites to `${prefix}../assets/...` for nested pages
   and a one-off `../assets/...` for `index.html`. Do **not** hard-code
   relative paths in the nav builder.

6. **Multi-parent hierarchy resolution is "prefer deepest".** Notion may
   sync the same subtree under several parent pages. The resolver in
   `src/commands/rerender.ts` (`blockContainers` + `depthOf` +
   `pickContainer`) lazily computes parent depth and picks the deepest
   candidate. `commands/export.ts#buildHierarchy` is cycle-aware: it refuses
   to cache results whose ancestor chain was truncated by a cycle — a
   different traversal may resolve correctly; don't memoize the partial
   answer.

7. **Incremental + resume are ON by default** (`src/commands/export.ts`).
   Incremental clones raw/md/html and carries forward asset records when
   `lastEditedTime` matches. Resume continues writing into the most recent
   partial export under `OUT_DIR`. Disable with `--no-incremental` /
   `--no-resume` or `--force`. Any new per-page state must be re-emittable
   from cloned raw JSON, or `rerender` and resume both regress.

8. **Operator-untrusted text in HTML attribute contexts MUST use
   `escapeHtmlText`** (`src/export/html.ts`). The helper escapes
   `& < > " '` — all five — so the same call is safe inside element bodies
   *and* inside `title="…"`, `alt="…"`, `data-*="…"`, etc. Do **not**
   reach for a body-only escaper (e.g. one that leaves `"` alone) when
   emitting an attribute. Notion-sourced titles, captions, emoji slugs and
   property values are the operator-untrusted strings most commonly
   threaded into attributes.

9. **Every URL-bearing attribute in user-facing HTML MUST go through
   `safeLinkUrl(...)` before interpolation** (`src/export/markdown.ts`).
   That gate rejects `javascript:` / `data:` / `file:` / `vbscript:`
   schemes and returns `#` on rejection. It applies to every `<a href>`,
   `<img src>`, `<audio src>`, `<video src>`, `<iframe src>`, and embed
   anchor emitted from a renderer (~11 call-sites in `markdown.ts`).
   Bypassing it lets a workspace member
   plant clickable XSS via a Notion `rich_text` `href` field, a media
   block URL, or a file/PDF link.

10. **`writeStylesheet` emits ONLY `style.css`.** Each client asset
    (`writeKatexCss`, `writeLightboxJs`, `writeLunr`, `writeSearchJs`)
    is its own finalize call. Every command that emits HTML
    (`export`, `rerender`, `repair`) invokes each writer explicitly —
    including `repair`, which rebuilds the search index from on-disk
    markdown. A regression in this area shipped repaired exports
    referencing `katex.min.css` / `search-index.js` while the files
    weren't there — if you add a new client asset, add a writer *and*
    wire it into all three command finalize phases, otherwise the
    asset silently ships in one but is missing in the others.

11. **`exportTimestamp` is the wall-clock time the rendered HTML was last
    produced.** Both `runExport` and `runRerender` set it to
    `new Date().toISOString()` and write the same value into
    `manifest.timestamp`, so the footer/sitemap/manifest always reflect the
    most recent render — not the original export.

12. **Canonical kanban + filter-chip order is a five-tier precedence chain.**
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

13. **Views drive layout; heuristics are the fallback.** ALL of a DB's views
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

## Common gotchas

- **Backticks inside the `STYLE_CSS` template literal** (`src/export/styles.ts`)
  break the build — the file is one tagged template. Strip backticks from
  JSDoc comments and CSS content. Same trap for `${...}` — escape with
  `\${...}` for a literal.

- **Custom-emoji `local_path` values are root-relative** (e.g.
  `assets/<hash>.png`). Every filesystem op on these paths must go through
  `assertWithinRoot` (`src/util/fs.ts`) before reading/writing, or a
  poisoned raw JSON could traverse out of `paths.root`.

- **Page chrome is built in one place — `src/export/pipeline.ts#renderPage`**
  (and `renderDatabase` for standalone DB pages). All three commands —
  `export`, `rerender`, `repair` — delegate to the pipeline rather than
  assembling `MarkdownOptions` themselves. `MarkdownOptions` extends
  `PageHeader`, `RenderServices`, and `PageChrome` (`src/export/markdown.ts`);
  if you add a new field to any of those three, wire it into
  `pipeline.ts#renderPage` (and `renderDatabase` if applicable) **and**
  every direct test caller that hand-rolls `MarkdownOptions`. The commands
  themselves shouldn't need changes — if you're tempted to edit them, the
  pipeline is the right seam.

- **`escapeHtmlText` is attribute-safe, but `<code>` content does NOT
  go through it.** `escapeHtmlText` escapes `& < > " '` so it is safe
  inside HTML element bodies *and* attributes. However the inline-code
  annotation path in `markdown.ts` emits raw `<code>…</code>` HTML
  rather than markdown backticks, and the `<code>` body is **not**
  pushed through `escapeHtmlText` — `marked` re-escapes the contents
  inside fenced and inline code blocks itself. Double-escaping `'` and
  `"` in code spans is a regression vector — if you add a new
  code-emitting path, mirror the marked semantics; do not pre-escape.

- **`assertWithinRootAsync` is the symlink-aware variant** for paths
  read from disk (i.e. `rerender`, `repair`). The sync
  `assertWithinRoot` is for the write path only, where the path doesn't
  yet exist. A symlink planted in a stamped export tree only fails the
  async (realpath-checked) gate; do not use the sync version on the
  read seam.

- **Notion API v5 quirks.** DB rows now report `parent.type ===
  "data_source_id"` (older payloads use `database_id`); search returns
  unsupported `data_source` objects — filter to `page`/`database`. Inline
  databases come back with `parent.type === "block_id"`; walk up via
  `resolveContainer` (`src/notion/crawl.ts`). DB schemas with option
  lists (status / select / multi_select canonical order) come from
  `notion.dataSources.retrieve({ data_source_id })`, **NOT**
  `databases.retrieve(dbId)` — the v5 SDK no longer surfaces options on
  the database object. We persist the result as a top-level `dataSource`
  field on raw DB JSON (see invariant #12); the call is loose-typed via
  a cast in `src/notion/dataSourceSchema.ts` because the v5 typings are
  still in flux. A typings-update PR that drops the cast must verify the
  schema shape (`{ id, properties: { <name>: { options: [...] } } }`)
  still hydrates correctly.

- **SSRF gate fires on every asset hop** (`assertPublicHttpUrl`,
  `src/export/assets.ts`). Redirects are handled manually so each hop is
  re-checked. Do not switch to `fetch(..., { redirect: "follow" })` — that
  bypasses the gate.

- **Asset redirect helpers — don't reinvent.** `RedirectLoopError`
  (`src/export/assets.ts`) is thrown after `maxRedirects` hops; the
  SSRF retry loop treats it as terminal — do **not** wrap it in a
  retry. `byOriginalUrl` (same file) is the in-memory raw-URL →
  `AssetRecord` map kept across redirect hops so the final record is
  keyed by the *original* (pre-redirect) URL — the comment block above
  its return-record path is load-bearing; if you touch the redirect
  loop, re-read it first.

## Config knobs

All env vars are validated by the zod schema in `src/config.ts` — the JSDoc
per key is the documentation. Friendlier reference: `.env.example`. Notable
groups: `NOTION_TOKEN` / `OUT_DIR` / `RETENTION` / `LOG_LEVEL`;
`EXPORT_TITLE` / `EXPORT_ICON` (sidebar header); rate-limit knobs
(`NOTION_MIN_TIME`, `NOTION_MAX_CONCURRENT`, `NOTION_MAX_RETRIES`);
concurrency (`PAGE_CONCURRENCY`, `CRAWL_CONCURRENCY`, `ASSET_CONCURRENCY`);
feature flags (`EXPAND_CHILD_PAGES`, `EXPORT_ROW_MEDIA`, `PRETTY_RAW_JSON`,
`STYLE_BACK_LINKS`).

## Repo layout

```
src/
  cli.ts            commander entrypoint (4 verbs)
  config.ts         zod-validated env config
  logger.ts         pino
  progress.ts       TTY progress renderer
  version.ts        VERSION constant
  commands/
    check.ts        token + visibility smoke test
    export.ts       full orchestrator (crawl → fetch → render)
    rerender.ts     regenerate md/html from raw JSON
    repair.ts      retry failed assets in last export
  notion/
    client.ts       RateLimitedNotion (Bottleneck + retry)
    crawl.ts        search → child_page expansion → DiscoveredObject[]
    blocks.ts       recursive block fetch
    comments.ts     page-level comments (requires "Read comments" cap)
    meta.ts         icon/cover/lastEdited/url extractors
  export/
    pipeline.ts     single renderPage/renderDatabase chokepoint
    json.ts         raw page/db JSON writers
    markdown.ts     hand-rolled block → Markdown (RENDERERS dispatch)
    html.ts         marked + sitemap + injectSidebars + escapeHtmlText
    styles.ts       STYLE_CSS template literal
    assets.ts       downloader, SSRF gate, content-addressed dedup
    clientAssets.ts writes lunr.min.js, search.js, katex.min.css, lightbox.js
    searchIndex.ts  build + write the lunr index
    manifest.ts     hashes, counts, version, previous-export lookup
    retention.ts    prune oldest stamped dirs
    paths.ts        timestamp + safe filename helpers
  util/
    fs.ts           assertWithinRoot (sync, pre-write) + assertWithinRootAsync (realpath-checked, post-write reads)
    fsclone.ts      reflink/copyfile with fallback
    pool.ts         shared parallel-worker pool (rerender/repair)
test/               vitest; integration test mocks @notionhq/client
test/__snapshots__/ markdown deterministic-render snapshots
```

## Conventions

- Tests first / alongside. New block types ship with a snapshot.
- `pnpm lint && pnpm typecheck && pnpm test` clean before commit; CI green
  before merge.
- No new runtime deps without ROI — every dep is a maintenance promise.
- Asset/path mutations go through `assertWithinRoot`; log via pino, not
  `console.log`.

## Where the contract lives

- **`ROADMAP.md`** — shipped surface + non-goals + invariants.
- Git history is the changelog; check `git log` for behaviour history.
