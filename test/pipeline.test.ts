import { describe, expect, it } from "vitest";
import { collectChildDbsInColumnList } from "../src/export/pipeline.js";
import type { NotionBlock } from "../src/notion/blocks.js";

describe("pipeline: collectChildDbsInColumnList", () => {
  it("flags every child_database nested under a column_list (any depth)", () => {
    const blocks: NotionBlock[] = [
      {
        id: "cl",
        type: "column_list",
        children: [
          {
            id: "col-1",
            type: "column",
            children: [{ id: "cdb-A", type: "child_database", child_database: { title: "A" } }],
          },
          {
            id: "col-2",
            type: "column",
            children: [
              {
                id: "callout-1",
                type: "callout",
                children: [{ id: "cdb-B", type: "child_database", child_database: { title: "B" } }],
              },
            ],
          },
        ],
      },
      // child_database OUTSIDE any column_list — must NOT be flagged.
      { id: "cdb-C", type: "child_database", child_database: { title: "C" } },
    ] as unknown as NotionBlock[];

    const ids = collectChildDbsInColumnList(blocks);
    expect(ids.has("cdb-A")).toBe(true);
    expect(ids.has("cdb-B")).toBe(true);
    expect(ids.has("cdb-C")).toBe(false);
    expect(ids.size).toBe(2);
  });

  it("returns an empty set when no child_database touches a column_list", () => {
    const blocks: NotionBlock[] = [
      { id: "h1", type: "heading_1", heading_1: { rich_text: [] } },
      { id: "cdb", type: "child_database", child_database: { title: "X" } },
    ] as unknown as NotionBlock[];
    const ids = collectChildDbsInColumnList(blocks);
    expect(ids.size).toBe(0);
  });
});
