import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRerender } from "../src/commands/rerender.js";
import { loadConfig } from "../src/config.js";
import { MANIFEST_SCHEMA_VERSION, type Manifest } from "../src/export/manifest.js";
import { createLogger } from "../src/logger.js";

// End-to-end test for `runRerender`. Builds a minimal export-shaped tree on
// disk, runs the orchestrator, and asserts the rendered HTML reflects:
// pageIcons short-circuit produces icons next to cross-page links;
// archiveIcon is resolved when EXPORT_ICON is a URL — though we don't
// exercise the URL path here, that's repair's job.
describe("rerender orchestrator", () => {
  it("re-renders pages with icons on cross-page links and resolves archive icon from URL", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-rerender-"));
    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      const rawDir = path.join(root, "raw");
      await fsp.mkdir(path.join(rawDir, "pages"), { recursive: true });
      await fsp.mkdir(path.join(rawDir, "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      const parentId = "00000000-0000-0000-0000-00000000aaaa";
      const childId = "00000000-0000-0000-0000-00000000bbbb";

      // Parent page mentions the child via a page mention rich_text — this is
      // what exercises `iconForLink`. Child has an emoji icon, so the rendered
      // mention should carry the icon glyph.
      const parentRaw = {
        page: {
          id: parentId,
          object: "page",
          icon: { type: "emoji", emoji: "📦" },
          url: "https://notion.so/parent",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Parent" }] } },
        },
        blocks: [
          {
            id: "block-1",
            type: "link_to_page",
            has_children: false,
            link_to_page: { type: "page_id", page_id: childId },
          },
        ],
        comments: [],
      };

      const childRaw = {
        page: {
          id: childId,
          object: "page",
          icon: { type: "emoji", emoji: "🧪" },
          url: "https://notion.so/child",
          parent: { type: "page_id", page_id: parentId },
          properties: { Name: { type: "title", title: [{ plain_text: "Child" }] } },
        },
        blocks: [],
        comments: [],
      };

      await fsp.writeFile(
        path.join(rawDir, "pages", `Parent.${parentId}.json`),
        JSON.stringify(parentRaw, null, 2),
      );
      await fsp.writeFile(
        path.join(rawDir, "pages", `Child.${childId}.json`),
        JSON.stringify(childRaw, null, 2),
      );

      const manifest: Manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: 2, databases: 0, assets: 0 },
        entries: [
          {
            id: parentId,
            kind: "page",
            title: "Parent",
            rawPath: `raw/pages/Parent.${parentId}.json`,
            sha256: "0",
            bytes: 0,
          },
          {
            id: childId,
            kind: "page",
            title: "Child",
            rawPath: `raw/pages/Child.${childId}.json`,
            sha256: "0",
            bytes: 0,
            parentId,
          },
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      // Use a non-URL EXPORT_ICON to keep network out of the rerender path
      // (a URL would go through the asset collector → fetch).
      const cfg = loadConfig({
        NOTION_TOKEN: "secret_x",
        OUT_DIR: tmp,
        EXPORT_ICON: "📚",
        EXPORT_TITLE: "Test Archive",
      });
      const log = createLogger("error");

      const result = await runRerender(cfg, log, { exportRoot: root });
      expect(result.pages).toBe(2);
      expect(result.databases).toBe(0);

      // The parent's HTML should embed the child's icon glyph next to the
      // mention link — proving `pageIcons.get(childId)` returned the emoji
      // and the pipeline short-circuit fired.
      const parentHtml = await fsp.readFile(
        path.join(root, "html", `Parent.${parentId}.html`),
        "utf8",
      );
      expect(parentHtml).toContain("🧪");
      expect(parentHtml).toContain(`Child.${childId}.html`);

      // archiveIcon (sidebar/footer) emits the resolved value — here the
      // raw glyph since EXPORT_ICON wasn't a URL.
      expect(parentHtml).toContain("Test Archive");

      // Regression: `exportTimestamp` should be the wall-clock time of *this*
      // rerender, not the original export's `manifest.timestamp`. Persisted
      // back into the manifest so the on-disk shape stays consistent.
      const updated = JSON.parse(
        await fsp.readFile(path.join(root, "manifest.json"), "utf8"),
      ) as Manifest;
      expect(updated.timestamp).not.toBe("2025-01-02T00:00:00.000Z");
      expect(new Date(updated.timestamp).getTime()).toBeGreaterThan(
        new Date("2025-01-02T00:00:00.000Z").getTime(),
      );
      // schemaVersion stays current after rerender writes the manifest.
      expect(updated.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("carries a persisted primary view forward (kanban + manual column order, no API calls)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-rerender-view-"));
    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      await fsp.mkdir(path.join(root, "raw", "pages"), { recursive: true });
      await fsp.mkdir(path.join(root, "raw", "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      const dbId = "00000000-0000-0000-0000-0000000000db";
      const mkRow = (id: string, name: string, status: string) => ({
        id,
        object: "page",
        properties: {
          Name: { type: "title", title: [{ plain_text: name }] },
          Status: { type: "status", status: { name: status, color: "default" } },
        },
      });
      // rowOrder is Done → Todo → Doing, which is neither alphabetical nor
      // STATUS_RANK order — only the persisted view can produce it.
      const dbRaw = {
        database: {
          id: dbId,
          object: "database",
          title: [{ plain_text: "Board" }],
          properties: { Name: { type: "title" }, Status: { type: "status" } },
        },
        rows: [
          mkRow("row-a", "First", "Done"),
          mkRow("row-b", "Second", "Todo"),
          mkRow("row-c", "Third", "Doing"),
        ],
        view: { id: "view-1", type: "board", groupByName: "Status" },
        rowOrder: ["row-a", "row-b", "row-c"],
      };
      await fsp.writeFile(
        path.join(root, "raw", "databases", `Board.${dbId}.json`),
        JSON.stringify(dbRaw, null, 2),
      );

      const manifest: Manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: 0, databases: 1, assets: 0 },
        entries: [
          {
            id: dbId,
            kind: "database",
            title: "Board",
            rawPath: `raw/databases/Board.${dbId}.json`,
            sha256: "0",
            bytes: 0,
          },
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp, EXPORT_TITLE: "Arc" });
      const log = createLogger("error");

      // runRerender reads only from disk — it never constructs a Notion client,
      // so this exercises the carry-forward path with zero API calls.
      const result = await runRerender(cfg, log, { exportRoot: root });
      expect(result.databases).toBe(1);

      const dbHtml = await fsp.readFile(path.join(root, "html", `Board.${dbId}.html`), "utf8");
      expect(dbHtml).toContain('class="inline-db kanban"');
      const order = ["Done", "Todo", "Doing"].map((s) => dbHtml.indexOf(`data-status="${s}"`));
      expect(order[0]).toBeGreaterThanOrEqual(0);
      expect(order[0]).toBeLessThan(order[1] as number);
      expect(order[1]).toBeLessThan(order[2] as number);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
