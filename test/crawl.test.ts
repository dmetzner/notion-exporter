import { describe, expect, it, vi } from "vitest";
import { crawlAll } from "../src/notion/crawl.js";

function fakeNotion(
  pages: Array<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>,
) {
  let i = 0;
  return {
    run: vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
      fn({
        search: async () => pages[i++],
      }),
    ),
  } as unknown as import("../src/notion/client.js").RateLimitedNotion;
}

describe("crawl", () => {
  it("paginates through search and extracts titles", async () => {
    const fake = fakeNotion([
      {
        results: [
          {
            object: "page",
            id: "p1",
            url: "u1",
            parent: { type: "workspace", workspace: true },
            properties: {
              Name: { type: "title", title: [{ plain_text: "Hello" }] },
            },
          },
          {
            object: "database",
            id: "d1",
            url: "u2",
            title: [{ plain_text: "My DB" }],
            parent: { type: "page_id", page_id: "p1" },
          },
        ],
        has_more: true,
        next_cursor: "c1",
      },
      {
        results: [
          {
            object: "page",
            id: "p2",
            parent: { type: "page_id", page_id: "p1" },
            properties: {
              Name: { type: "title", title: [{ plain_text: "Child" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    ]);

    const all = await crawlAll(fake);
    expect(all.map((o) => o.id)).toEqual(["p1", "d1", "p2"]);
    expect(all.map((o) => o.title)).toEqual(["Hello", "My DB", "Child"]);
    expect(all[1]!.parent).toEqual({ type: "page_id", id: "p1" });
    expect(all[0]!.parent).toEqual({ type: "workspace" });
  });

  it("includes block_id as parent.id and resolves unknown block parents via blocks.retrieve", async () => {
    // p1 (root page) → block_col (column block) → p2 (subpage)
    // p3's parent.block_id IS p1 (top-level subpage, block_id == page_id)
    const searchPages: Array<{
      results: unknown[];
      has_more: boolean;
      next_cursor: string | null;
    }> = [
      {
        results: [
          {
            object: "page",
            id: "p1",
            parent: { type: "workspace", workspace: true },
            properties: { Name: { type: "title", title: [{ plain_text: "Root" }] } },
          },
          {
            object: "page",
            id: "p2",
            parent: { type: "block_id", block_id: "block_col" },
            properties: { Name: { type: "title", title: [{ plain_text: "Nested" }] } },
          },
          {
            object: "page",
            id: "p3",
            parent: { type: "block_id", block_id: "p1" },
            properties: { Name: { type: "title", title: [{ plain_text: "Direct sub" }] } },
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    ];
    let i = 0;
    const blockRetrieves: string[] = [];
    const fake = {
      run: vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
        fn({
          search: async () => searchPages[i++],
          blocks: {
            retrieve: async ({ block_id }: { block_id: string }) => {
              blockRetrieves.push(block_id);
              if (block_id === "block_col") {
                return { id: block_id, parent: { type: "page_id", page_id: "p1" } };
              }
              return { id: block_id, parent: { type: "workspace" } };
            },
          },
        }),
      ),
    } as unknown as import("../src/notion/client.js").RateLimitedNotion;
    const all = await crawlAll(fake);
    const byId = new Map(all.map((o) => [o.id, o] as const));
    // p3 had block_id pointing at a known page → unchanged, still block_id with that id
    expect(byId.get("p3")!.parent).toEqual({ type: "block_id", id: "p1" });
    // p2 had block_id pointing at non-page block → resolved to containing page
    expect(byId.get("p2")!.parent).toEqual({ type: "page_id", id: "p1" });
    expect(blockRetrieves).toEqual(["block_col"]);
  });

  it("handles untitled objects", async () => {
    const fake = fakeNotion([
      {
        results: [
          { object: "page", id: "p", parent: { type: "workspace" }, properties: {} },
          { object: "database", id: "d", parent: { type: "workspace" }, title: [] },
        ],
        has_more: false,
        next_cursor: null,
      },
    ]);
    const all = await crawlAll(fake);
    expect(all[0]!.title).toBe("(untitled page)");
    expect(all[1]!.title).toBe("(untitled database)");
  });
});
