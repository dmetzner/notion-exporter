import { describe, expect, it, vi } from "vitest";
import { fetchDatabaseFull } from "../src/export/json.js";
import type { RateLimitedNotion } from "../src/notion/client.js";

/**
 * The v5 `@notionhq/client` removed `databases.query` in favor of
 * `dataSources.query`. `fetchDatabaseFull` must therefore retrieve the
 * database first to discover its data source ids and then query each one.
 */

interface FakeClient {
  databases: { retrieve: (args: { database_id: string }) => Promise<unknown> };
  dataSources: {
    query: (args: { data_source_id: string; start_cursor?: string }) => Promise<unknown>;
  };
}

function makeNotion(client: FakeClient): RateLimitedNotion {
  return {
    run: <T>(fn: (c: FakeClient) => Promise<T>) => fn(client),
  } as unknown as RateLimitedNotion;
}

describe("fetchDatabaseFull (v5 migration)", () => {
  it("queries dataSources.query using the database's data_sources[].id", async () => {
    const retrieve = vi.fn(async () => ({
      id: "db-1",
      object: "database",
      data_sources: [{ id: "ds-1", name: "default" }],
    }));
    const query = vi.fn(async () => ({
      results: [{ id: "row-a" }, { id: "row-b" }],
      has_more: false,
      next_cursor: null,
    }));
    const notion = makeNotion({
      databases: { retrieve },
      dataSources: { query },
    });

    const { database, rows } = await fetchDatabaseFull(notion, "db-1");

    expect(retrieve).toHaveBeenCalledWith({ database_id: "db-1" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      data_source_id: "ds-1",
      page_size: 100,
    });
    expect((database as { id: string }).id).toBe("db-1");
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(["row-a", "row-b"]);
  });

  it("paginates rows across multiple cursors", async () => {
    const retrieve = vi.fn(async () => ({
      id: "db-1",
      data_sources: [{ id: "ds-1", name: "default" }],
    }));
    const pages = [
      { results: [{ id: "r1" }], has_more: true, next_cursor: "c1" },
      { results: [{ id: "r2" }, { id: "r3" }], has_more: false, next_cursor: null },
    ];
    let i = 0;
    const query = vi.fn(async () => pages[i++]!);

    const notion = makeNotion({
      databases: { retrieve },
      dataSources: { query },
    });
    const { rows } = await fetchDatabaseFull(notion, "db-1");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toMatchObject({ start_cursor: "c1" });
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(["r1", "r2", "r3"]);
  });

  it("queries every data source when a database exposes multiple", async () => {
    const retrieve = vi.fn(async () => ({
      id: "db-1",
      data_sources: [
        { id: "ds-a", name: "A" },
        { id: "ds-b", name: "B" },
      ],
    }));
    const query = vi.fn(async ({ data_source_id }: { data_source_id: string }) => ({
      results: [{ id: `${data_source_id}-row` }],
      has_more: false,
      next_cursor: null,
    }));
    const notion = makeNotion({
      databases: { retrieve },
      dataSources: { query },
    });
    const { rows } = await fetchDatabaseFull(notion, "db-1");
    expect(query).toHaveBeenCalledTimes(2);
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(["ds-a-row", "ds-b-row"]);
  });

  it("returns no rows when database has no data sources", async () => {
    const retrieve = vi.fn(async () => ({ id: "db-1" }));
    const query = vi.fn();
    const notion = makeNotion({
      databases: { retrieve },
      dataSources: { query },
    });
    const { rows } = await fetchDatabaseFull(notion, "db-1");
    expect(query).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});
