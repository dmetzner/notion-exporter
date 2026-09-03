# notion-exporter — guide for Claude Code

Backs a Notion workspace up to browsable Markdown + HTML on disk. This file holds the
invariants and traps that are not obvious from any single source file; `README.md` is the
user-facing description and `ROADMAP.md` is the shipped surface and non-goals.

## The gate

```bash
pnpm check        # lint + typecheck + test + contrast — the CI mirror and the pre-commit gate
```

Individual pieces when iterating:

```bash
pnpm dev <verb>   # tsx; verb = check|export|rerender|repair
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm build        # tsup → dist/cli.js
```

## Stack

Node ≥ 22.19 (undici 8 floor), TypeScript strict, ESM-only, pnpm. Vitest (unit + snapshot;
integration tests mock `@notionhq/client`). Biome for lint + format — no Prettier, no ESLint.
tsup → a single `dist/cli.js` bin.

## The four verbs

| Verb | Use when |
|---|---|
| `check` | Smoke-test `NOTION_TOKEN` and report visible objects. No writes. |
| `export` | Full or incremental backup → `OUT_DIR/<timestamp>/`. `--force` for a clean run. |
| `rerender` | Regenerate md/html/sitemap/search from existing raw JSON. No API calls. |
| `repair` | Retry failed assets in the most recent export, re-signing expired Notion S3 URLs. |

`export` defaults to **incremental ON, resume ON**. `--no-incremental` / `--no-resume` disable
them individually; `--force` flips both off.

## Invariants

Load-bearing. Breaking any of them corrupts exports silently.

1. **All Notion API calls go through `RateLimitedNotion#run`** (`src/notion/client.ts`). The
   Bottleneck limiter and the 429/5xx retry that honours `Retry-After` are wired there.
   `new Client(...)` directly skips both.

2. **Asset URLs from Notion expire (~1 h).** Always download via the asset collector
   (`src/export/assets.ts#createAssetCollector`); never store the raw URL. On 401/403/410 the
   collector invokes the caller's `refresh` callback to mint a fresh signed URL. `repair`
   exists to retry this against the most recent export, mutating raw JSON in place so later
   rerenders pick up the new `local_path`.

3. **The Markdown renderer is hand-rolled** (`src/export/markdown.ts`). Do **not** add
   `notion-to-md`. Extend the renderer for new block types and keep output deterministic — the
   snapshots under `test/__snapshots__/` are the gate.

4. **Custom emoji shortcodes (`:slug:`) render as `<img class="custom-emoji">`.** Notion ships
   them as a separate `plain_text` run plus a `custom_emoji` mention, so titles reaching
   sidebar entries, breadcrumbs and child-page links must pass through `enrichTitle`
   (`src/commands/rerender.ts`), or the equivalent inline swap in `commands/export.ts`, before
   emission. Otherwise the literal `:slug:` leaks into the rendered nav.

5. **Sidebar HTML is shared across every page.** `injectSidebars` (`src/export/html.ts`) builds
   one nav tree and stamps it into every HTML file with depth-correct `../` prefixes.
   Custom-emoji `<img>` tags in the nav use **root-relative** `src="assets/<hash>.png"`, which
   `injectSidebars` rewrites per depth. Never hard-code relative paths in the nav builder.

6. **Multi-parent hierarchy resolution is "prefer deepest".** Notion may sync the same subtree
   under several parents; the resolver in `src/commands/rerender.ts` (`blockContainers` +
   `depthOf` + `pickContainer`) picks the deepest candidate.
   `commands/export.ts#buildHierarchy` is cycle-aware and **refuses to cache** a result whose
   ancestor chain was truncated by a cycle — a different traversal may resolve correctly, so
   the partial answer must not be memoized.

7. **Incremental and resume are ON by default.** Incremental clones raw/md/html and carries
   asset records forward when `lastEditedTime` matches; resume continues writing into the most
   recent partial export. **Any new per-page state must be re-emittable from cloned raw JSON**,
   or both `rerender` and resume regress.

8. **Operator-untrusted text in HTML attribute contexts MUST use `escapeHtmlText`**
   (`src/export/html.ts`). It escapes all five of `& < > " '`, so the same call is safe inside
   element bodies *and* inside `title=`, `alt=`, `data-*=`. Never reach for a body-only escaper
   when emitting an attribute. Notion-sourced titles, captions, emoji slugs and property values
   are the strings most commonly threaded into attributes.

9. **Every URL-bearing attribute in user-facing HTML MUST go through `safeLinkUrl(...)`**
   (`src/export/markdown.ts`) before interpolation. It rejects `javascript:` / `data:` /
   `file:` / `vbscript:` and returns `#`. It applies to every `<a href>`, `<img src>`,
   `<audio src>`, `<video src>`, `<iframe src>` and embed anchor. Bypassing it lets a workspace
   member plant clickable XSS through a `rich_text` `href`, a media block URL, or a file link.

10. **`writeStylesheet` emits ONLY `style.css`.** Each client asset (`writeKatexCss`,
    `writeLightboxJs`, `writeLunr`, `writeSearchJs`) is its own finalize call, and all three
    HTML-emitting commands — `export`, `rerender`, `repair` — invoke each writer explicitly. A
    regression here once shipped repaired exports referencing files that were not there. **A
    new client asset needs a writer AND a wire-up in all three finalize phases.**

11. **`exportTimestamp` is the wall-clock time the rendered HTML was last produced.** Both
    `runExport` and `runRerender` set it and write the same value into `manifest.timestamp`, so
    footer, sitemap and manifest always reflect the most recent render — not the original
    export.

12. **Column and view order follow a five-tier precedence chain**, and views drive layout.
    Dropping the `dataSource` field, or building `viewRank` when `data.view` is absent,
    silently reorders every board in an export. Full contract:
    [`docs/database-views.md`](docs/database-views.md).

## Gotchas

- **Backticks inside the `STYLE_CSS` template literal** (`src/export/styles.ts`) break the
  build — the file is one tagged template. Strip backticks from JSDoc and CSS content; escape a
  literal `${...}` as `\${...}`.
- **Custom-emoji `local_path` values are root-relative.** Every filesystem op on them must go
  through `assertWithinRoot` (`src/util/fs.ts`), or a poisoned raw JSON traverses out of
  `paths.root`.
- **`assertWithinRootAsync` is the symlink-aware variant** for paths read from disk (`rerender`,
  `repair`). The sync `assertWithinRoot` is for the write path only, where the path does not yet
  exist. A symlink planted in a stamped export tree only fails the realpath-checked gate.
- **Page chrome is built in one place — `src/export/pipeline.ts#renderPage`** (and
  `renderDatabase` for standalone DB pages). All three commands delegate to it rather than
  assembling `MarkdownOptions` themselves. A new field on `PageHeader`, `RenderServices` or
  `PageChrome` gets wired into the pipeline **and** every test caller that hand-rolls
  `MarkdownOptions`. If you are tempted to edit a command, the pipeline is the right seam.
- **`escapeHtmlText` is attribute-safe, but `<code>` content does NOT go through it.** The
  inline-code path emits raw `<code>…</code>` and `marked` re-escapes code contents itself;
  pre-escaping double-escapes `'` and `"`. Mirror the marked semantics in any new code-emitting
  path.
- **The SSRF gate fires on every asset hop** (`assertPublicHttpUrl`, `src/export/assets.ts`).
  Redirects are followed manually so each hop is re-checked — never switch to
  `fetch(..., { redirect: "follow" })`.
- **Do not reinvent the asset redirect helpers.** `RedirectLoopError` is terminal; the SSRF
  retry loop must not wrap it in a retry. `byOriginalUrl` keeps the raw-URL → `AssetRecord` map
  across hops so the final record is keyed by the *pre-redirect* URL.
- **Notion API v5 quirks.** DB rows report `parent.type === "data_source_id"` (older payloads
  use `database_id`); search returns unsupported `data_source` objects, so filter to
  `page`/`database`; inline databases arrive with `parent.type === "block_id"` and need
  `resolveContainer` (`src/notion/crawl.ts`); option lists come from
  `notion.dataSources.retrieve({ data_source_id })`, **not** `databases.retrieve(dbId)`. That
  call is loose-typed via a cast in `src/notion/dataSourceSchema.ts` because the v5 typings are
  in flux — a PR that drops the cast must verify the schema shape still hydrates.

## Config

Every env var is validated by the zod schema in `src/config.ts`, and the JSDoc per key is the
documentation — `.env.example` is the friendlier reference. Do not document them a third time
here.

## Layout

Only the entries whose location is not guessable:

- `src/export/pipeline.ts` — the single `renderPage`/`renderDatabase` chokepoint every command
  delegates to.
- `src/export/markdown.ts` — the hand-rolled block renderer (`RENDERERS` dispatch) and
  `safeLinkUrl`.
- `src/export/html.ts` — marked, sitemap, `injectSidebars`, `escapeHtmlText`.
- `src/export/styles.ts` — `STYLE_CSS`, one tagged template literal.
- `src/export/assets.ts` — downloader, SSRF gate, content-addressed dedup, redirect helpers.
- `src/notion/client.ts` — `RateLimitedNotion`; `src/notion/views.ts` — the Views API capture.
- `src/util/fs.ts` — `assertWithinRoot` (sync, pre-write) and `assertWithinRootAsync` (the read
  seam).

## Conventions

- Tests first or alongside. A new block type ships with a snapshot.
- `pnpm check` clean before commit; CI green before merge.
- No new runtime dependency without ROI — every dependency is a maintenance promise.
- Path and asset mutations go through `assertWithinRoot`. Log via pino, never `console.log`.

## More

- [`docs/database-views.md`](docs/database-views.md) — the five-tier column-order chain, the
  Views API capture, tabbed rendering, and the linked-view rescue.
- `ROADMAP.md` — shipped surface, non-goals, invariants.
- Git history is the changelog.
