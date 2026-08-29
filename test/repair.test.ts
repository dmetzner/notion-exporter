import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createAssetCollector } from "../src/export/assets.js";
import { formatProp } from "../src/export/markdown.js";
import { buildPaths } from "../src/export/paths.js";
import { type RenderContext, renderPage } from "../src/export/pipeline.js";
import { createLogger } from "../src/logger.js";

// Regression test: repair must pass the full `MarkdownOptions` set to
// `pageToMarkdown`. A prior shape passed only 4 of 10 fields, dropping
// breadcrumbs/children/properties from repaired pages. The single shared
// renderer requires every caller to build the complete option set — this
// test pins that contract from a repair-shaped RenderContext.
describe("pipeline: repair-shaped context renders all MarkdownOptions", () => {
  it("renders breadcrumbs + page-children + page-properties when applicable", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-pipeline-"));
    const exportRoot = path.join(tmp, "2025-01-02T00-00-00Z");
    await fsp.mkdir(path.join(exportRoot, "assets"), { recursive: true });
    await fsp.mkdir(path.join(exportRoot, "markdown"), { recursive: true });
    await fsp.mkdir(path.join(exportRoot, "html"), { recursive: true });

    const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
    const log = createLogger("error");
    const paths = buildPaths(tmp, path.basename(exportRoot));
    const assets = createAssetCollector({
      assetsDir: paths.assets,
      exportRoot: paths.root,
      log,
      concurrency: 1,
    });

    // A two-page hierarchy with a DB-row child so breadcrumbs + properties
    // both apply. The child also lists its own children via the `children`
    // option so the page-children section renders.
    const parentId = "parent-page-id-aaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const childId = "child-page-id-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const grandchildId = "grand-page-id-cccccccccccccccccccccccccccc";

    const pageIndex = new Map([
      [
        parentId,
        {
          id: parentId,
          title: "Parent",
          kind: "page" as const,
          mdAbsPath: path.join(paths.markdown, `Parent.${parentId}.md`),
          subdir: "",
        },
      ],
      [
        childId,
        {
          id: childId,
          title: "Child",
          kind: "page" as const,
          mdAbsPath: path.join(paths.markdown, `Child.${childId}.md`),
          subdir: "",
          parentId,
        },
      ],
      [
        grandchildId,
        {
          id: grandchildId,
          title: "Grand",
          kind: "page" as const,
          mdAbsPath: path.join(paths.markdown, `Grand.${grandchildId}.md`),
          subdir: "",
          parentId: childId,
        },
      ],
    ]);

    const ctx: RenderContext = {
      paths,
      pageIndex,
      dbDataById: new Map(),
      customEmojiByName: new Map(),
      archiveIcon: cfg.render.exportIcon,
      archiveTitle: cfg.render.exportTitle,
      cfg,
      assets,
      log,
      exportTimestamp: "2025-01-02T00:00:00.000Z",
      // Mimic repair's ancestor walker: chain via pageIndex.parentId.
      ancestorIds: (id: string) => {
        const chain: string[] = [];
        const seen = new Set<string>();
        let cursor = pageIndex.get(id)?.parentId;
        while (cursor && pageIndex.has(cursor) && !seen.has(cursor)) {
          seen.add(cursor);
          chain.unshift(cursor);
          cursor = pageIndex.get(cursor)?.parentId;
        }
        return chain;
      },
    };

    // Child page is a database-row page (parent.type === "database_id")
    // with a non-title `Status` property → page-props table.
    const childRawPage = {
      id: childId,
      parent: { type: "database_id", database_id: "db-id" },
      properties: {
        Name: { type: "title", title: [{ plain_text: "Child" }] },
        Status: { type: "select", select: { name: "Done", color: "green" } },
      },
      last_edited_time: "2025-01-02T00:00:00.000Z",
      url: "https://notion.so/child",
      icon: { type: "emoji", emoji: "📄" },
    };

    const rendered = await renderPage(
      ctx,
      { id: childId, title: "Child", page: childRawPage, blocks: [] },
      {
        formatProp,
        children: [{ href: `Grand.${grandchildId}.md`, title: "Grand", kind: "page" }],
      },
    );
    expect(rendered).not.toBeNull();
    const html = await fsp.readFile(rendered!.htmlAbs, "utf8");

    // The three CSS hooks the bug was silently stripping.
    expect(html).toContain('class="breadcrumbs"');
    expect(html).toContain('class="breadcrumbs"');
    expect(html).toContain('class="page-children"');
    expect(html).toContain('class="page-props"');

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  // A tampered raw/pages/*.json with
  // `custom_emoji.local_path = 'assets/x" onerror=alert(1)' ` flows into the
  // `enrichTitle` <img src="…"> site. The `src` value must be URL-encoded so
  // the `"` cannot escape the attribute.
  it('neutralizes a custom-emoji local_path that tries to escape src="…"', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-emoji-xss-"));
    await fsp.mkdir(path.join(tmp, "assets"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "markdown"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "html"), { recursive: true });

    const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
    const log = createLogger("error");
    const paths = buildPaths(path.dirname(tmp), path.basename(tmp));
    const assets = createAssetCollector({
      assetsDir: paths.assets,
      exportRoot: paths.root,
      log,
      concurrency: 1,
    });

    const pageId = "evil-page-id-eeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const pageIndex = new Map([
      [
        pageId,
        {
          id: pageId,
          title: "Title with :pwn: emoji",
          kind: "page" as const,
          mdAbsPath: path.join(paths.markdown, `Title.${pageId}.md`),
          subdir: "",
        },
      ],
    ]);

    // The tampered local_path — what an attacker would write into a raw JSON
    // file's `custom_emoji.local_path`. Lexical assertWithinRoot lets this
    // through (no `..`), and path.relative preserves it verbatim.
    const tamperedLocalPath = 'assets/x" onerror="alert(1)';

    const ctx: RenderContext = {
      paths,
      pageIndex,
      dbDataById: new Map(),
      customEmojiByName: new Map([["pwn", tamperedLocalPath]]),
      archiveIcon: cfg.render.exportIcon,
      archiveTitle: cfg.render.exportTitle,
      cfg,
      assets,
      log,
      exportTimestamp: "2025-01-02T00:00:00.000Z",
      ancestorIds: () => [],
    };

    const rendered = await renderPage(
      ctx,
      { id: pageId, title: "Title with :pwn: emoji", page: null, blocks: [] },
      {},
    );
    expect(rendered).not.toBeNull();
    const html = await fsp.readFile(rendered!.htmlAbs, "utf8");

    // The emoji must have been substituted (the `:pwn:` form is gone).
    expect(html).toContain('class="custom-emoji"');
    // Critical: the raw `" onerror="alert(1)` payload must NOT appear in the
    // rendered HTML. The `"` must be URL-encoded to `%22` inside src.
    expect(html).not.toMatch(/onerror=["']?alert/);
    expect(html).not.toMatch(/src="[^"]*"[^>]*onerror/);
    // Positive: the percent-encoded form is present (mdUrl encodes `"` and ` `).
    expect(html).toMatch(/src="[^"]*%22[^"]*"/);

    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
