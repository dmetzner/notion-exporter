# Notion API v5 quirks

What the v5 SDK returns differently from older payloads, and where the code handles it.

- **Notion API v5 quirks.** DB rows report `parent.type === "data_source_id"` (older payloads
  use `database_id`); search returns unsupported `data_source` objects, so filter to
  `page`/`database`; inline databases arrive with `parent.type === "block_id"` and need
  `resolveContainer` (`src/notion/crawl.ts`); option lists come from
  `notion.dataSources.retrieve({ data_source_id })`, **not** `databases.retrieve(dbId)`. That
  call is loose-typed via a cast in `src/notion/dataSourceSchema.ts` because the v5 typings are
  in flux — a PR that drops the cast must verify the schema shape still hydrates.
