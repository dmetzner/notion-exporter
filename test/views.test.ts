import { describe, expect, it } from "vitest";
import { type ExportedDatabase, filterRowsToOrder } from "../src/export/json.js";
import { applyViewOrder } from "../src/export/markdown/database.js";
import type { DatabaseRow } from "../src/export/markdown/types.js";
import { databaseToMarkdown } from "../src/export/markdown.js";
import { toViewSchema, validateView } from "../src/notion/views.js";

describe("applyViewOrder", () => {
  const rows: DatabaseRow[] = [
    { id: "a", properties: {} },
    { id: "b", properties: {} },
    { id: "c", properties: {} },
  ];

  it("is a no-op without a rowOrder", () => {
    expect(applyViewOrder(rows, undefined)).toBe(rows);
    expect(applyViewOrder(rows, [])).toBe(rows);
  });

  it("reorders rows to match rowOrder", () => {
    const out = applyViewOrder(rows, ["c", "a", "b"]);
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("filters out rows absent from rowOrder", () => {
    const out = applyViewOrder(rows, ["b"]);
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("falls back to the original rows when the intersection is empty", () => {
    const out = applyViewOrder(rows, ["x", "y"]);
    expect(out).toBe(rows);
  });
});

describe("filterRowsToOrder (linked-view rescue)", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("keeps only the rows the view shows (render-time applyViewOrder re-sorts)", () => {
    // Source data source has 4 rows; this linked view shows 2. Filtering keeps
    // source order — the renderer reorders by rowOrder afterwards.
    expect(filterRowsToOrder(rows, ["c", "a"]).map((r) => (r as { id: string }).id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("returns [] for an empty rowOrder", () => {
    expect(filterRowsToOrder(rows, [])).toEqual([]);
  });
});

describe("toViewSchema", () => {
  it("normalizes a board view config", () => {
    const raw = {
      object: "view",
      id: "v1",
      type: "board",
      name: "By status",
      configuration: {
        type: "board",
        group_by: { type: "status", property_id: "pid", property_name: "Status" },
        properties: [
          { property_id: "t", property_name: "Name", visible: true },
          { property_id: "p", property_name: "Priority", visible: true },
          { property_id: "h", property_name: "Hidden", visible: false },
        ],
      },
    };
    expect(toViewSchema(raw)).toEqual({
      id: "v1",
      type: "board",
      name: "By status",
      groupByName: "Status",
      visibleProps: ["Name", "Priority"],
    });
  });

  it("captures the view's data_source_id (linked-view source)", () => {
    const v = toViewSchema({
      id: "v",
      type: "gallery",
      data_source_id: "src-123",
      configuration: { type: "gallery" },
    });
    expect(v).toMatchObject({ type: "gallery", dataSourceId: "src-123" });
  });

  it("captures calendar + timeline date properties", () => {
    expect(
      toViewSchema({ id: "v", type: "calendar", configuration: { date_property_name: "Due" } }),
    ).toMatchObject({ type: "calendar", datePropertyName: "Due" });
    expect(
      toViewSchema({
        id: "v",
        type: "timeline",
        configuration: { date_property_name: "Start", end_date_property_name: "End" },
      }),
    ).toMatchObject({ type: "timeline", datePropertyName: "Start", endDatePropertyName: "End" });
  });

  it("rejects partial view objects (no usable config)", () => {
    expect(toViewSchema({ object: "view", id: "v1" })).toBeNull();
    expect(toViewSchema({ object: "view", id: "v1", type: "wat" })).toBeNull();
    expect(toViewSchema(null)).toBeNull();
    expect(toViewSchema([])).toBeNull();
  });
});

describe("validateView", () => {
  it("accepts a well-formed persisted schema", () => {
    const v = { id: "v", type: "board", groupByName: "Status", visibleProps: ["A", "B"] };
    expect(validateView(v)).toEqual(v);
  });

  it("rejects malformed / unknown-type payloads (operator-tampered raw JSON)", () => {
    expect(validateView({ type: "board" })).toBeNull(); // no id
    expect(validateView({ id: "v", type: "bogus" })).toBeNull();
    expect(validateView("nope")).toBeNull();
  });

  it("drops a non-string-array visibleProps rather than trusting it", () => {
    const v = validateView({ id: "v", type: "table", visibleProps: [1, 2, 3] });
    expect(v).not.toBeNull();
    expect(v?.visibleProps).toBeUndefined();
  });
});

// --- View-driven rendering (end to end through databaseToMarkdown) ---------

function boardDb(): ExportedDatabase {
  // Three statuses present; rowOrder is arranged so first-occurrence yields
  // Done → Todo → Doing — which is NEITHER alphabetical NOR STATUS_RANK order,
  // proving the view's manual column order wins.
  return {
    id: "d",
    title: "Board",
    database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
    rows: [
      mkRow("r1", "First", "Done"),
      mkRow("r2", "Second", "Todo"),
      mkRow("r3", "Third", "Doing"),
    ],
    views: [
      { view: { id: "v", type: "board", groupByName: "Status" }, rowOrder: ["r1", "r2", "r3"] },
    ],
  };
}

function mkRow(id: string, name: string, status: string): DatabaseRow {
  return {
    id,
    properties: {
      Name: { type: "title", title: [{ plain_text: name }] },
      Status: { type: "status", status: { name: status, color: "default" } },
    },
  };
}

describe("view-driven layout selection + ordering", () => {
  it("a board view renders kanban regardless of row count / heuristic", () => {
    const md = databaseToMarkdown(boardDb());
    expect(md).toContain('class="inline-db kanban"');
  });

  it("kanban columns follow the view's manual order (first-occurrence over rowOrder)", () => {
    const md = databaseToMarkdown(boardDb());
    const order = ["Done", "Todo", "Doing"].map((s) => md.indexOf(`data-status="${s}"`));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1] as number);
    expect(order[1]).toBeLessThan(order[2] as number);
  });

  it("rowOrder filters out rows the view excludes", () => {
    const db = boardDb();
    db.views![0].rowOrder = ["r1", "r3"]; // drop r2 (Todo)
    const md = databaseToMarkdown(db);
    expect(md).toContain('data-status="Done"');
    expect(md).toContain('data-status="Doing"');
    expect(md).not.toContain('data-status="Todo"');
  });

  it("renders multiple views as labelled CSS radio tabs (first checked)", () => {
    const db: ExportedDatabase = {
      id: "multi",
      title: "Produkte",
      database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
      rows: [mkRow("r1", "A", "Done"), mkRow("r2", "B", "Todo")],
      views: [
        { view: { id: "v1", type: "gallery", name: "🛒 Produkte" }, rowOrder: ["r1", "r2"] },
        { view: { id: "v2", type: "gallery", name: "🛒 Protein-Produkte" }, rowOrder: ["r1"] },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('class="inline-db-tabbed"');
    // One radio per view, first checked; both names labelled.
    expect((md.match(/class="view-tab-radio"/g) ?? []).length).toBe(2);
    expect(md).toContain("checked");
    expect(md).toContain("🛒 Produkte");
    expect(md).toContain("🛒 Protein-Produkte");
    expect((md.match(/class="view-panel"/g) ?? []).length).toBe(2);
  });

  it("gallery cards carry hidden per-column filter data (so chip filters match)", () => {
    // Regression: without these, every active chip/date/number filter rejected
    // all gallery cards (cellValueFor → null) — and once `[hidden]` started
    // hiding them, filtering wiped the whole gallery.
    const db: ExportedDatabase = {
      id: "g",
      title: "Produkte",
      database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
      rows: [mkRow("r1", "A", "Done"), mkRow("r2", "B", "Todo")],
      views: [{ view: { id: "v", type: "gallery", name: "All" }, rowOrder: ["r1", "r2"] }],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('class="db-card-filter-data" data-col="Status"');
    expect(md).toContain("data-filter-values=");
  });

  it("shows the view name even for a single view", () => {
    const db = boardDb();
    db.views = [
      {
        view: { id: "v", type: "board", name: "By status", groupByName: "Status" },
        rowOrder: ["r1", "r2", "r3"],
      },
    ];
    const md = databaseToMarkdown(db);
    expect(md).toContain('class="inline-db-tabbed"');
    expect(md).toContain("By status");
  });

  it("a calendar view renders a month grid bucketed by the date property", () => {
    const db: ExportedDatabase = {
      id: "c",
      title: "Cal",
      database: { properties: { Name: { type: "title" }, Due: { type: "date" } } },
      rows: [
        dateRow("r1", "Kickoff", "2024-03-05"),
        dateRow("r2", "Review", "2024-03-20"),
        dateRow("r3", "Ship", "2024-04-02"),
      ],
      views: [{ view: { id: "v", type: "calendar", datePropertyName: "Due" }, rowOrder: [] }],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('class="inline-db calendar"');
    expect(md).toContain("March 2024");
    expect(md).toContain("April 2024");
    expect(md).toContain('class="calendar-event"');
  });

  it("a timeline view renders positioned bars over the min→max span", () => {
    const db: ExportedDatabase = {
      id: "t",
      title: "Roadmap",
      database: {
        properties: { Name: { type: "title" }, Start: { type: "date" }, End: { type: "date" } },
      },
      rows: [
        rangeRow("r1", "Phase 1", "2024-01-01", "2024-02-01"),
        rangeRow("r2", "Phase 2", "2024-02-01", "2024-04-01"),
      ],
      views: [
        {
          view: {
            id: "v",
            type: "timeline",
            datePropertyName: "Start",
            endDatePropertyName: "End",
          },
          rowOrder: [],
        },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('class="inline-db timeline"');
    expect(md).toContain('class="timeline-bar"');
    expect(md).toMatch(/left:0\.00%/); // earliest bar anchored at the start
    expect(md).toContain("2024-01-01");
    expect(md).toContain("2024-04-01");
  });

  it("a timeline with only point dates degrades to a sorted table", () => {
    const db: ExportedDatabase = {
      id: "t",
      title: "Points",
      database: { properties: { Name: { type: "title" }, Start: { type: "date" } } },
      rows: [dateRow("r1", "A", "2024-01-05"), dateRow("r2", "B", "2024-01-02")],
      views: [{ view: { id: "v", type: "timeline", datePropertyName: "Start" }, rowOrder: [] }],
    };
    const md = databaseToMarkdown(db);
    expect(md).not.toContain("timeline-bar");
    expect(md).toContain("inline-db-table");
  });

  it("a list view renders a vertical row list with inline visible-prop meta", () => {
    const db: ExportedDatabase = {
      id: "lst",
      title: "Notes",
      database: { properties: { Name: { type: "title" }, Tag: { type: "select" } } },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "First note" }] },
            Tag: { type: "select", select: { name: "Idea", color: "blue" } },
          },
        },
      ],
      views: [{ view: { id: "v", type: "list", visibleProps: ["Name", "Tag"] }, rowOrder: [] }],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('class="inline-db inline-db-list"');
    expect(md).toContain('class="db-list-link"');
    expect(md).toContain("First note");
    expect(md).toContain("Idea");
    expect(md).not.toContain("inline-db-table");
  });

  it("a table view restricts + orders columns to the view's visible properties", () => {
    const db: ExportedDatabase = {
      id: "tab",
      title: "Tasks",
      database: {
        properties: {
          Name: { type: "title" },
          Priority: { type: "select" },
          Secret: { type: "rich_text" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Task" }] },
            Priority: { type: "select", select: { name: "High", color: "red" } },
            Secret: { type: "rich_text", rich_text: [{ plain_text: "hidden" }] },
          },
        },
      ],
      views: [
        { view: { id: "v", type: "table", visibleProps: ["Name", "Priority"] }, rowOrder: [] },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('data-col-name="Name"');
    expect(md).toContain('data-col-name="Priority"');
    expect(md).not.toContain('data-col-name="Secret"');
  });
});

function dateRow(id: string, name: string, start: string): DatabaseRow {
  return {
    id,
    properties: {
      Name: { type: "title", title: [{ plain_text: name }] },
      Due: { type: "date", date: { start } },
      Start: { type: "date", date: { start } },
    },
  };
}

function rangeRow(id: string, name: string, start: string, end: string): DatabaseRow {
  return {
    id,
    properties: {
      Name: { type: "title", title: [{ plain_text: name }] },
      Start: { type: "date", date: { start } },
      End: { type: "date", date: { start: end } },
    },
  };
}
