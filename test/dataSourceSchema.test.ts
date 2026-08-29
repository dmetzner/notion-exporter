import { describe, expect, it, vi } from "vitest";
import { createDataSourceSchemaCache, exportAllJson } from "../src/export/json.js";
import { createLogger } from "../src/logger.js";
import type { RateLimitedNotion } from "../src/notion/client.js";
import type { DiscoveredObject } from "../src/notion/crawl.js";
import { validateDataSourceSchema } from "../src/notion/dataSourceSchema.js";

interface FakeClient {
  databases: { retrieve: (args: { database_id: string }) => Promise<unknown> };
  dataSources: {
    retrieve: (args: { data_source_id: string }) => Promise<unknown>;
    query: (args: { data_source_id: string; start_cursor?: string }) => Promise<unknown>;
  };
}

function makeNotion(client: FakeClient): RateLimitedNotion {
  return {
    run: <T>(fn: (c: FakeClient) => Promise<T>) => fn(client),
  } as unknown as RateLimitedNotion;
}

describe("data source schema", () => {
  it("returns the schema with options ordered as Notion returns them", async () => {
    const retrieve = vi.fn(async ({ data_source_id }: { data_source_id: string }) => ({
      id: data_source_id,
      properties: {
        Status: {
          id: "s1",
          name: "Status",
          type: "status",
          status: {
            options: [
              { id: "o1", name: "Backlog", color: "default" },
              { id: "o2", name: "Doing", color: "blue" },
              { id: "o3", name: "Done", color: "green" },
            ],
            groups: [],
          },
        },
      },
    }));
    const notion = makeNotion({
      databases: { retrieve: vi.fn() },
      dataSources: { retrieve, query: vi.fn() },
    });
    const cache = createDataSourceSchemaCache(notion);
    const schema = await cache("ds-1");
    expect(schema?.id).toBe("ds-1");
    expect(schema?.properties.Status?.status?.options.map((o) => o.name)).toEqual([
      "Backlog",
      "Doing",
      "Done",
    ]);
  });

  it("caches: one retrieve per unique data_source_id even across N calls", async () => {
    const retrieve = vi.fn(async ({ data_source_id }: { data_source_id: string }) => ({
      id: data_source_id,
      properties: {},
    }));
    const notion = makeNotion({
      databases: { retrieve: vi.fn() },
      dataSources: { retrieve, query: vi.fn() },
    });
    const cache = createDataSourceSchemaCache(notion);
    // 3 calls for ds-A, 2 for ds-B — expect 2 total retrieves.
    await Promise.all([cache("ds-A"), cache("ds-A"), cache("ds-B"), cache("ds-A"), cache("ds-B")]);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it("returns undefined and logs when retrieve fails (renderer falls back)", async () => {
    const retrieve = vi.fn(async () => {
      throw new Error("integration lacks access");
    });
    const notion = makeNotion({
      databases: { retrieve: vi.fn() },
      dataSources: { retrieve, query: vi.fn() },
    });
    const log = createLogger("error");
    const cache = createDataSourceSchemaCache(notion, log);
    const schema = await cache("ds-bad");
    expect(schema).toBeUndefined();
  });

  describe("validateDataSourceSchema", () => {
    it("returns the typed schema when shape is plausible", () => {
      const raw = {
        id: "ds-x",
        properties: { Name: { id: "n", name: "Name", type: "title" } },
      };
      const out = validateDataSourceSchema(raw, "fallback-id");
      expect(out).not.toBeNull();
      expect(out?.id).toBe("ds-x");
      expect(out?.properties.Name?.type).toBe("title");
    });

    it("uses fallback id when raw.id is not a string", () => {
      const raw = { id: 42, properties: {} };
      const out = validateDataSourceSchema(raw, "fallback-id");
      expect(out?.id).toBe("fallback-id");
    });

    it("returns null when properties is missing", () => {
      expect(validateDataSourceSchema({ id: "x" }, "fid")).toBeNull();
    });

    it("returns null when properties is a string", () => {
      expect(validateDataSourceSchema({ id: "x", properties: "oops" }, "fid")).toBeNull();
    });

    it("returns null when properties is an array", () => {
      expect(validateDataSourceSchema({ id: "x", properties: [] }, "fid")).toBeNull();
    });

    it("returns null on entirely non-object input", () => {
      expect(validateDataSourceSchema(null, "fid")).toBeNull();
      expect(validateDataSourceSchema("string", "fid")).toBeNull();
      expect(validateDataSourceSchema([1, 2], "fid")).toBeNull();
    });
  });

  it("exportAllJson de-dupes schema fetches when two DBs share a data source", async () => {
    // Two databases that resolve to the same data source id (`shared-ds`).
    // The schema cache must collapse them to a single `dataSources.retrieve`.
    const dbRetrieve = vi.fn(async ({ database_id }: { database_id: string }) => ({
      id: database_id,
      data_sources: [{ id: "shared-ds", name: "shared" }],
    }));
    const dsRetrieve = vi.fn(async ({ data_source_id }: { data_source_id: string }) => ({
      id: data_source_id,
      properties: {
        Status: {
          id: "s1",
          name: "Status",
          type: "status",
          status: { options: [{ id: "o1", name: "Open", color: "blue" }], groups: [] },
        },
      },
    }));
    const dsQuery = vi.fn(async () => ({
      results: [],
      has_more: false,
      next_cursor: null,
    }));
    const notion = makeNotion({
      databases: { retrieve: dbRetrieve },
      dataSources: { retrieve: dsRetrieve, query: dsQuery },
    });
    const log = createLogger("error");
    const objects: DiscoveredObject[] = [
      { id: "db-1", object: "database", title: "A", parent: { type: "workspace" } },
      { id: "db-2", object: "database", title: "B", parent: { type: "workspace" } },
    ];
    const dataSourceSchema = createDataSourceSchemaCache(notion, log);
    const received: Array<{ id: string; dataSourceId?: string }> = [];
    await exportAllJson({
      notion,
      objects,
      log,
      onPage: async () => {},
      onDatabase: async (d) => {
        received.push({ id: d.id, dataSourceId: d.dataSource?.id });
      },
      dataSourceSchema,
    });
    expect(dsRetrieve).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      { id: "db-1", dataSourceId: "shared-ds" },
      { id: "db-2", dataSourceId: "shared-ds" },
    ]);
  });
});
