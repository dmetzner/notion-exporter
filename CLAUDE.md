# notion-exporter

Backs a Notion workspace up to browsable Markdown + HTML on disk. `README.md` is the user-facing
description (verbs, flags, output layout); `ROADMAP.md` is the shipped surface and non-goals.

## The gate

```bash
pnpm check        # lint + typecheck + test + contrast — the CI mirror and the pre-commit gate
```

`pnpm dev <verb>` runs the CLI from source; the other scripts are in `package.json`.

## How changes land

**Every change goes through a pull request — no direct pushes to `main`.** Merging needs three
things: this repo's gate green locally (`pnpm check`), CI green, and an independent review with
no unresolved high or major finding on the commit that gets merged.

**A CI job that could not START is not a pass.** A billing-blocked Actions run dies with no logs
and no steps; that is "could not run", and it is said out loud on the PR rather than merged past
in silence.

**The only exception is a project Daniel has explicitly called prototyping. This is not one.**

## Stack

Node ≥ 22.19 (undici 8 floor), TypeScript strict, ESM-only, pnpm. Vitest (unit + snapshot;
integration tests mock `@notionhq/client`). Biome for lint + format — no Prettier, no ESLint.
tsup → a single `dist/cli.js` bin.

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

7. **Incremental and resume are ON by default** (`--force` turns both off). Incremental clones raw/md/html and carries
   asset records forward when `lastEditedTime` matches; resume continues writing into the most
   recent partial export. **Any new per-page state must be re-emittable from cloned raw JSON**,
   or both `rerender` and resume regress.

8. **Operator-untrusted text in HTML attribute contexts MUST use `escapeHtmlText`**
   (`src/export/html.ts`). It escapes all five of `& < > " '`, so the same call is safe inside
   element bodies *and* inside `title=`, `alt=`, `data-*=`. Never reach for a body-only escaper
   when emitting an attribute. Notion-sourced titles, captions, emoji slugs and property values
   are the strings most commonly threaded into attributes. `rt()` (`src/export/markdown.ts`)
   escapes every `plain_text` run *before* layering bold/link/`<img>` wrappers on it.

9. **Every URL-bearing attribute in user-facing HTML MUST go through `safeLinkUrl(...)`**
   (`src/export/markdown.ts`) before interpolation. It rejects `javascript:` / `data:` /
   `file:` / `vbscript:` and returns `#`. It applies to every `<a href>`, `<img src>`,
   `<audio src>`, `<video src>`, `<iframe src>` and embed anchor. Bypassing it lets a workspace
   member plant clickable XSS through a `rich_text` `href`, a media block URL, or a file link.

10. **`writeStylesheet` emits ONLY `style.css`.** Each client asset (`writeKatexCss`,
    `writeLightboxJs`, `writeLunr`, `writeSearchJs`) has its own writer, and all three
    HTML-emitting commands — `export`, `rerender`, `repair` — reach them through one
    `finalizeSite` (`src/export/finalizeAssets.ts`). **A new client asset needs a writer AND a
    line in `finalizeClientAssets`**, or exports reference files that are not there.

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
- **Every path and asset filesystem op goes through `assertWithinRoot`** (`src/util/fs.ts`) —
  custom-emoji `local_path` values are root-relative, and a poisoned raw JSON otherwise
  traverses out of `paths.root`. Paths read from disk (`rerender`, `repair`) use the
  symlink-aware `assertWithinRootAsync`; the sync variant is for not-yet-existing write paths.
- **Page chrome is built in one place — `src/export/pipeline.ts#renderPage`** (and
  `renderDatabase` for standalone DB pages). All three commands delegate to it rather than
  assembling `MarkdownOptions` themselves. A new field on `PageHeader`, `RenderServices` or
  `PageChrome` gets wired into the pipeline **and** every test caller that hand-rolls
  `MarkdownOptions`.
- **`escapeHtmlText` is attribute-safe, but `<code>` content does NOT go through it.** The
  inline-code path emits raw `<code>…</code>` and `marked` re-escapes code contents itself;
  pre-escaping double-escapes `'` and `"`. Mirror the marked semantics in any new code-emitting
  path.
- **The SSRF gate (`assertPublicHttpUrl`, `src/export/assets.ts`) re-checks every redirect
  hop** — never switch to `fetch(..., { redirect: "follow" })`. `RedirectLoopError` is terminal
  (never retried); `byOriginalUrl` keys the final record by the *pre-redirect* URL.
- **Notion API v5 shapes differ from older payloads** (DB-row parents, `data_source` search hits,
  inline-DB parents, option lists). Read [`docs/notion-api-v5.md`](docs/notion-api-v5.md) before
  touching crawl or schema code.

## Layout

Locations not named above:

- `src/notion/views.ts` — the Views API capture.
- `src/config.ts` — the zod schema for every env var; its per-key JSDoc is the documentation.

## Conventions

A new block type ships with a snapshot. No new runtime dependency without clear ROI. Log via
pino, never `console.log`.

## More

- [`docs/notion-api-v5.md`](docs/notion-api-v5.md) — v5 payload shapes and the
  `dataSources.retrieve` cast.
- [`docs/database-views.md`](docs/database-views.md) — the five-tier column-order chain, the
  Views API capture, tabbed rendering, and the linked-view rescue.
- `ROADMAP.md` — shipped surface and non-goals.
