import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runExport } from "../src/commands/export.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";

// Mock the Notion SDK Client so the integration test doesn't hit the network.
vi.mock("@notionhq/client", () => {
  const data = {
    search: vi.fn(async () => ({
      results: [
        {
          object: "page",
          id: "page-1",
          url: "https://notion/page-1",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Top" }] } },
        },
        {
          object: "page",
          id: "page-2",
          url: "https://notion/page-2",
          parent: { type: "page_id", page_id: "page-1" },
          properties: { Name: { type: "title", title: [{ plain_text: "Child" }] } },
        },
        {
          object: "database",
          id: "db-1",
          url: "https://notion/db-1",
          title: [{ plain_text: "Tasks" }],
          parent: { type: "page_id", page_id: "page-1" },
        },
      ],
      has_more: false,
      next_cursor: null,
    })),
    pagesRetrieve: vi.fn(async ({ page_id }: { page_id: string }) => ({
      id: page_id,
      object: "page",
      properties: { Name: { type: "title", title: [{ plain_text: `Page ${page_id}` }] } },
    })),
    blocksList: vi.fn(async ({ block_id }: { block_id: string }) => {
      if (block_id === "page-1") {
        return {
          results: [
            {
              id: "b1",
              type: "heading_1",
              has_children: false,
              heading_1: { rich_text: [{ plain_text: "Hello" }] },
            },
            {
              id: "b2",
              type: "image",
              has_children: false,
              image: { type: "file", file: { url: "https://signed/cat.png", expiry_time: "x" } },
            },
          ],
          has_more: false,
          next_cursor: null,
        };
      }
      return { results: [], has_more: false, next_cursor: null };
    }),
    dbRetrieve: vi.fn(async ({ database_id }: { database_id: string }) => ({
      id: database_id,
      object: "database",
      title: [{ plain_text: "Tasks" }],
      data_sources: [{ id: `${database_id}-ds`, name: "default" }],
    })),
    dsRetrieve: vi.fn(async ({ data_source_id }: { data_source_id: string }) => ({
      id: data_source_id,
      object: "data_source",
      properties: {
        Name: { id: "title", name: "Name", type: "title", title: {} },
        Status: {
          id: "abc",
          name: "Status",
          type: "status",
          status: {
            options: [
              { id: "todo", name: "To-Do", color: "default" },
              { id: "doing", name: "In Progress", color: "blue" },
              { id: "done", name: "Done", color: "green" },
            ],
            groups: [],
          },
        },
      },
    })),
    dsQuery: vi.fn(async () => ({
      results: [
        {
          id: "row-1",
          object: "page",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Done: { type: "checkbox", checkbox: true },
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    })),
    usersMe: vi.fn(async () => ({ id: "u1", name: "Bot", type: "bot" })),
    commentsList: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
    // Views API (GA): list → first ref is the default; retrieve → config;
    // queries.create/results → the filtered/sorted/group-ordered page ids.
    viewsList: vi.fn(async () => ({
      object: "list",
      results: [{ object: "view", id: "view-1" }],
      has_more: false,
      next_cursor: null,
    })),
    viewsRetrieve: vi.fn(async ({ view_id }: { view_id: string }) => ({
      object: "view",
      id: view_id,
      type: "board",
      name: "By status",
      configuration: {
        type: "board",
        group_by: { type: "status", property_id: "abc", property_name: "Status" },
      },
    })),
    viewQueryCreate: vi.fn(async () => ({
      object: "view_query",
      id: "q1",
      results: [{ object: "page", id: "row-1" }],
      has_more: false,
      next_cursor: null,
    })),
    viewQueryResults: vi.fn(async () => ({
      object: "list",
      results: [],
      has_more: false,
      next_cursor: null,
      type: "page",
    })),
  };

  class Client {
    search = data.search;
    pages = { retrieve: data.pagesRetrieve };
    blocks = { children: { list: data.blocksList } };
    databases = { retrieve: data.dbRetrieve };
    dataSources = { query: data.dsQuery, retrieve: data.dsRetrieve };
    users = { me: data.usersMe };
    comments = { list: data.commentsList };
    views = {
      list: data.viewsList,
      retrieve: data.viewsRetrieve,
      queries: { create: data.viewQueryCreate, results: data.viewQueryResults },
    };
  }

  return { Client };
});

describe("integration: full export", () => {
  it("produces raw/markdown/html/assets/manifest", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-int-"));
    const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
    const log = createLogger("error");

    const origFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
        },
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null) },
      }) as unknown as Response) as unknown as typeof fetch;

    try {
      const result = await runExport(cfg, log, { dryRun: false });
      expect(result.pages).toBe(2);
      expect(result.databases).toBe(1);
      expect(result.assets).toBe(1);

      const root = result.exportRoot!;
      const rawPages = await fsp.readdir(path.join(root, "raw", "pages"));
      expect(rawPages.length).toBe(2);
      const rawDbs = await fsp.readdir(path.join(root, "raw", "databases"));
      expect(rawDbs.length).toBe(1);
      const assets = await fsp.readdir(path.join(root, "assets"));
      expect(assets.length).toBe(1);
      const sitemap = await fsp.readFile(path.join(root, "html", "index.html"), "utf8");
      expect(sitemap).toContain("Top");
      expect(sitemap).toContain("Tasks");
      const manifest = JSON.parse(await fsp.readFile(path.join(root, "manifest.json"), "utf8"));
      expect(manifest.counts).toMatchObject({ pages: 2, databases: 1, assets: 1 });

      // raw json contains local_path rewrite on image block
      const topRaw = JSON.parse(
        await fsp.readFile(
          path.join(root, "raw", "pages", rawPages.find((f) => f.includes("page-1"))!),
          "utf8",
        ),
      );
      const imgBlock = topRaw.blocks.find((b: { type: string }) => b.type === "image");
      expect(imgBlock.image.local_path).toMatch(/^assets\//);

      // Raw DB JSON carries the persisted data-source schema with option
      // order matching what `dataSources.retrieve` returned.
      const dbRaw = JSON.parse(
        await fsp.readFile(path.join(root, "raw", "databases", rawDbs[0]!), "utf8"),
      );
      expect(dbRaw.dataSource).toBeDefined();
      expect(dbRaw.dataSource.id).toBe("db-1-ds");
      expect(
        dbRaw.dataSource.properties.Status.status.options.map((o: { id: string }) => o.id),
      ).toEqual(["todo", "doing", "done"]);

      // Raw DB JSON also carries the captured views[] (config + per-view row
      // order from the View Query API), normalized to the compact shape.
      expect(dbRaw.views).toHaveLength(1);
      expect(dbRaw.views[0].view).toMatchObject({
        id: "view-1",
        type: "board",
        groupByName: "Status",
      });
      expect(dbRaw.views[0].rowOrder).toEqual(["row-1"]);
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("dry-run prints IDs without writing", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-dry-"));
    const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
    const log = createLogger("error");
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      const result = await runExport(cfg, log, { dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.objects).toHaveLength(3);
      const combined = writes.join("");
      expect(combined).toContain("page-1");
      expect(combined).toContain("db-1");
    } finally {
      process.stdout.write = orig;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
