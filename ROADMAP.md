# Roadmap

Shipped surface, non-goals, and architectural invariants for
`notion-exporter`. For day-to-day agent rules, see
[`CLAUDE.md`](./CLAUDE.md); git log is the per-change history.

## Shipped

`notion-exporter` is a Node 20+ CLI that backs up a single Notion workspace to
a local, timestamped directory containing full-fidelity raw JSON, a
hand-rolled Markdown tree, a self-contained HTML site, and downloaded assets.
Four commands cover the lifecycle: `check` validates the token and reports
visible objects; `export` enumerates via `search`, fetches pages/blocks/DB
rows through a rate-limited (Bottleneck + 429/5xx retry) client, downloads
assets to a content-addressed store, and writes raw JSON + Markdown + HTML +
`manifest.json` (with a `schemaVersion` gate so future readers can migrate
older exports); `rerender` regenerates Markdown/HTML/sitemap/search from the
existing raw JSONs without touching the Notion API; `repair` retries
asset downloads against the most recent export, re-signing expired Notion S3
URLs via `pages.retrieve`. All three rendering commands route through a single
`src/export/pipeline.ts#renderPage` chokepoint so renderer behavior cannot
drift between them. Both `export` runs default to **incremental** (diffing
`last_edited_time` against the previous manifest) and **resumable**
(continuing a partial export); `--force` falls back to a full fresh export.
Output ships a Notion-style HTML site with hierarchical sidebar nav,
client-side lunr search, light/dark theme, custom-emoji rendering, rich-text
mentions, DB table views with relation columns, page covers/icons/breadcrumbs,
page comments (top-level, author + timestamp), KaTeX inline and block math,
native `<audio>` / `<video>` players, YouTube / Vimeo / Loom embed iframes
with bookmark-card fallback for other providers, a click-to-zoom image
lightbox, WCAG-AA contrast on every swatch (enforced by `pnpm contrast`), and
optional retention pruning. Distributed via npm (`npx notion-exporter`) and
GHCR Docker images, built with tsup, lint+format via biome 2.x, tests in
vitest with deterministic Markdown snapshots.

Subsequent passes layered correctness, security, performance, and
tech-debt cleanup on top of that surface. Notable areas:

- **Security defense-in-depth.** `assertWithinRootAsync` follows
  symlinks via `fsp.realpath` for every operator-trusted read;
  `safeLinkUrl` gates every `<audio>` / `<video>` / `<img>` / `<iframe>`
  `src`; YouTube / Vimeo / Loom iframes ship `sandbox` + `allow` +
  `referrerpolicy="no-referrer"`; PDF iframe ships `allow-scripts`
  without `allow-same-origin`; "Open in Notion" anchors gain
  `rel="noopener" target="_blank"`; failed-asset warn logs strip Notion
  S3 signed query params; SSRF downloader pins the pre-verified IP
  through TLS via an undici `buildConnector` `lookup` override.
- **Renderer surface.** Kanban-style rendering grouped by status /
  select with `EXPORT_DB_VIEW=auto|table|kanban`; type-aware filter UI
  for inline DBs (chips, date/number range, sort dropdown, URL-hash
  state); compact card view for inline DBs in narrow columns; a
  five-tier column-ordering precedence chain
  (`config.order` > view order > `dataSource` > `STATUS_RANK` >
  first-occurrence).
- **Views API integration.** ALL of a DB's views are captured from the GA
  Views API (`fetchAllViews`) and drive layout, grouping, visible columns,
  and exact row/column order (via the View Query API). Multiple views render
  as **CSS-only radio tabs** (no JS), each chip labelled with the view name.
  Adds native `calendar` (month grid), `timeline` (gantt bars), and `list`
  renderers; `gallery`/`table`/`board` map to existing renderers;
  `form`/`chart`/`map`/`dashboard` degrade to the table renderer. Persisted
  as `views[]` on raw DB JSON and carried forward by `rerender`/`repair`
  (zero API calls; `normalizeViews` also reads the legacy single-view shape).
  Heuristics remain the fallback for legacy exports / DBs without a view.
- **Linked-view rescue.** "Linked view of database" inline blocks (empty
  API stubs, historically unrecoverable) are resolved via the view's
  `data_source_id`: the real source is queried and filtered to the view's
  `rowOrder`. The incremental backfill rescues cloned stubs (with row
  media) so existing exports recover on a normal run, no `--force`.
- **Per-DB operator overrides.** A `%%notion-exporter` JSON fence in
  the DB description configures `view` / `groupBy` / `order` /
  `hideFilters` / `cardMeta` (parsed by `parseDbConfig`).
- **Asset pipeline.** `RedirectLoopError` guard with redirect-cap,
  `byOriginalUrl` map so redirected hops still key their `AssetRecord`
  by the original Notion URL, manifest scrubbed of signed-URL params,
  shared custom-emoji downloader across `export` / `rerender` /
  `repair`, full client-asset finalize from `repair`.

## Non-goals

- **No restore-from-export.** The Notion API does not support writing pages
  back; this tool is a read-only archive, not a sync engine.
- **No cloud sync.** No built-in S3/WebDAV/Nextcloud upload — the user points
  their existing sync client at the output directory.
- **Single workspace per export.** One `NOTION_TOKEN`, one workspace, one
  output tree. Multi-workspace = run the CLI multiple times with different
  envs.
- **No OAuth / multi-tenant flow.** Internal integration tokens only. Public
  OAuth would require a hosted callback proxy (Notion has no PKCE); out of
  scope.
- **Not a Notion mirror.** The output is a faithful point-in-time archive,
  not a live read-through cache. A DB's *primary* view is snapshotted (layout
  + group + filtered/sorted order, captured at export time); secondary views,
  live re-querying, and workspace-level settings outside the exposed API are
  not reconstructed.

## Architectural invariants

These rules bind every change — load-bearing architectural invariants of
the project. Breaking any of them silently corrupts exports.

- **All Notion API calls go through `RateLimitedNotion#run`.** The
  Bottleneck limiter and 429/5xx retry are wired there; bypassing it
  silently breaks rate-limit behavior under load.

- **Asset URLs from Notion expire (~1 h).** Always download; never store
  the raw URL. When the original URL 403s mid-export, re-fetch the parent
  via `notion.pages.retrieve` to mint a fresh signed URL — that's what the
  `refresh` callback wired through `assets.collect()` is for. `repair`
  exists specifically to retry this against the most recent export.

- **`rt()` (`src/export/markdown.ts`) escapes HTML before applying
  styles.** Every Notion-supplied `plain_text` run flows through
  `escapeHtmlText` first, then bold/italic/link/`<img>` wrappers are
  layered on. Skipping the escape lets a `<script>` in a page title
  execute when the export is opened in a browser.

- **Sidebar HTML is shared across every page.** `injectSidebars`
  (`src/export/html.ts`) builds one nav tree and stamps it into every
  emitted HTML file with depth-correct `../` prefixes. Custom-emoji
  `<img>` tags whose `src` is root-relative `assets/<hash>.png` are
  rewritten to `${prefix}../assets/...` at injection time — do NOT
  hard-code relative paths inside the nav builder.

- **Notion `:name:` custom emojis ship as `plain_text` + a `custom_emoji`
  mention.** Render the mention as an inline `<img class="custom-emoji">`;
  if you forget, the literal `:name:` leaks into the page.

- **Hierarchy resolution is cycle-aware.** `buildHierarchy` in
  `commands/export.ts` short-circuits cycles and refuses to cache results
  whose ancestor chain was truncated. A different traversal path may
  resolve the same id correctly — don't memoize the partial answer.

- **Markdown converter is intentionally hand-rolled.** Do not pull in
  `notion-to-md`. Extend `src/export/markdown.ts` for new block types;
  keep output deterministic (snapshot tests live in `test/__snapshots__/`).

- **Every URL-bearing attribute goes through `safeLinkUrl`.** The
  helper (`src/export/markdown.ts`) rejects `javascript:` / `data:` /
  `file:` / `vbscript:` URIs and returns `#` on rejection. It must wrap
  every `<a href>`, `<img src>`, `<audio src>`, `<video src>`, and
  `<iframe src>` emitted from a renderer. Skipping it lets a workspace
  member plant clickable XSS via Notion `rich_text` `href` fields or a
  media block URL.

- **`writeStylesheet` emits ONLY `style.css`.** `writeKatexCss`,
  `writeLightboxJs`, `writeLunr`, and `writeSearchJs` are independent
  finalize calls. `export`, `rerender`, and `repair` each invoke them
  explicitly; new client assets must be wired into all three command
  finalize phases.
