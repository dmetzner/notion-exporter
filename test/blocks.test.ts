import { describe, expect, it } from "vitest";
import { fetchBlocksRecursive, type NotionBlock } from "../src/notion/blocks.js";
import type { RateLimitedNotion } from "../src/notion/client.js";

function makeNotion(tree: Record<string, NotionBlock[]>): RateLimitedNotion {
  const client = {
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => ({
          results: structuredClone(tree[block_id] ?? []),
          has_more: false,
          next_cursor: null,
        }),
      },
    },
  };
  return {
    run: <T>(fn: (c: typeof client) => Promise<T>) => fn(client),
  } as unknown as RateLimitedNotion;
}

const para = (id: string): NotionBlock => ({ id, type: "paragraph" });
const synced = (id: string, from: string | null): NotionBlock => ({
  id,
  type: "synced_block",
  has_children: true,
  synced_block: { synced_from: from ? { block_id: from } : null },
});

describe("fetchBlocksRecursive", () => {
  it("fills every copy of a synced block that appears twice on one page", async () => {
    const notion = makeNotion({
      page: [synced("orig", null), synced("copy", "orig")],
      orig: [para("p1")],
    });
    const blocks = await fetchBlocksRecursive(notion, "page");
    expect(blocks.map((b) => b.children?.map((c) => c.id))).toEqual([["p1"], ["p1"]]);
  });

  it("still stops on a synced block that points back at its ancestor", async () => {
    const notion = makeNotion({
      page: [synced("loop", "page")],
    });
    const blocks = await fetchBlocksRecursive(notion, "page");
    expect(blocks[0]?.children).toEqual([]);
  });
});
