import { describe, expect, it, vi } from "vitest";
import type { RateLimitedNotion } from "../src/notion/client.js";
import { fetchPageComments } from "../src/notion/comments.js";

// Tiny fake `RateLimitedNotion` that just runs the closure against the
// supplied fake client, mirroring the pattern used in test/integration.test.ts
// and test/json.test.ts.
interface FakeClient {
  comments: {
    list: (args: { block_id: string; start_cursor?: string }) => Promise<unknown>;
  };
}

function makeNotion(client: FakeClient): RateLimitedNotion {
  return {
    run: <T>(fn: (c: FakeClient) => Promise<T>) => fn(client),
  } as unknown as RateLimitedNotion;
}

describe("fetchPageComments", () => {
  it("returns an empty array when the page has no comments", async () => {
    const list = vi.fn(async () => ({ results: [], has_more: false, next_cursor: null }));
    const notion = makeNotion({ comments: { list } });
    const out = await fetchPageComments(notion, "page-1");
    expect(out).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ block_id: "page-1" });
  });

  it("flattens results across multiple paginated responses", async () => {
    const pages = [
      {
        results: [
          { id: "c1", created_time: "2026-05-20T00:00:00Z" },
          { id: "c2", created_time: "2026-05-20T01:00:00Z" },
        ],
        has_more: true,
        next_cursor: "cursor-1",
      },
      {
        results: [{ id: "c3", created_time: "2026-05-20T02:00:00Z" }],
        has_more: true,
        next_cursor: "cursor-2",
      },
      {
        results: [{ id: "c4", created_time: "2026-05-20T03:00:00Z" }],
        has_more: false,
        next_cursor: null,
      },
    ];
    let i = 0;
    const list = vi.fn(async () => pages[i++]!);
    const notion = makeNotion({ comments: { list } });

    const out = await fetchPageComments(notion, "page-2");

    expect(out.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(list).toHaveBeenCalledTimes(3);
    // First call has no start_cursor; subsequent calls follow next_cursor.
    expect(list.mock.calls[0]?.[0]).toMatchObject({ block_id: "page-2" });
    expect(list.mock.calls[0]?.[0]?.start_cursor).toBeUndefined();
    expect(list.mock.calls[1]?.[0]).toMatchObject({
      block_id: "page-2",
      start_cursor: "cursor-1",
    });
    expect(list.mock.calls[2]?.[0]).toMatchObject({
      block_id: "page-2",
      start_cursor: "cursor-2",
    });
  });

  it("stops paginating when has_more is false even with a next_cursor present", async () => {
    // Defensive: Notion sometimes returns a stale next_cursor alongside
    // has_more: false. We must not loop on it.
    const list = vi.fn(async () => ({
      results: [{ id: "only" }],
      has_more: false,
      next_cursor: "ignored-cursor",
    }));
    const notion = makeNotion({ comments: { list } });
    const out = await fetchPageComments(notion, "page-3");
    expect(out.map((c) => c.id)).toEqual(["only"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from the underlying API call", async () => {
    const list = vi.fn(async () => {
      throw new Error("unauthorized");
    });
    const notion = makeNotion({ comments: { list } });
    await expect(fetchPageComments(notion, "page-4")).rejects.toThrow("unauthorized");
  });
});
