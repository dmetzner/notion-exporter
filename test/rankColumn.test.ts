import { describe, expect, it } from "vitest";
import { rankColumn } from "../src/export/markdown/database.js";

describe("rankColumn", () => {
  // Precedence table (lower wins):
  //   1. configRank      (operator override)
  //   2. viewRank        (primary view's exact/manual column order)
  //   3. dataSourceRank  (Notion workspace option order)
  //   4. STATUS_RANK     (legacy heuristic)
  //   5. tier-5 floor    (unknown, 4e6)
  // "No status" is always pinned at the very end (+Infinity, strictly > tier 5).

  it("config tier beats dataSource tier even when ds index is smaller", () => {
    const config = new Map([
      ["Done", 0],
      ["In progress", 1],
      ["Todo", 2],
    ]);
    const ds = new Map([
      ["Todo", 0],
      ["In progress", 1],
      ["Done", 2],
    ]);
    // Operator's "Done"=0 must beat dataSource's "Todo"=0 because tier 1 < tier 3.
    expect(rankColumn("Done", config, null, ds)).toBeLessThan(rankColumn("Todo", config, null, ds));
  });

  it("view tier beats dataSource + STATUS_RANK but loses to config", () => {
    const view = new Map([["Done", 0]]);
    const ds = new Map([["Todo", 0]]);
    // view "Done"=0 (tier 2) beats ds "Todo"=0 (tier 3).
    expect(rankColumn("Done", null, view, ds)).toBeLessThan(rankColumn("Todo", null, view, ds));
    // ...but an operator config still wins over the view.
    const config = new Map([["Todo", 0]]);
    expect(rankColumn("Todo", config, view, ds)).toBeLessThan(rankColumn("Done", config, view, ds));
  });

  it("dataSource tier beats STATUS_RANK tier", () => {
    // dataSource ranks "Done" first; STATUS_RANK ranks "Todo" first ("todo"=0,
    // "done"=3). dataSource wins.
    const ds = new Map([["Done", 0]]);
    expect(rankColumn("Done", null, null, ds)).toBeLessThan(rankColumn("Todo", null, null, ds));
  });

  it("STATUS_RANK tier beats unknown-name tier", () => {
    // "todo" is rank-0 in STATUS_RANK; "Whatever" is unknown.
    expect(rankColumn("Todo", null, null, null)).toBeLessThan(
      rankColumn("Whatever", null, null, null),
    );
  });

  it("unknown names land in the tier-5 band, strictly before NO_STATUS", () => {
    const r = rankColumn("Whatever", null, null, null);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(4_000_000);
    expect(r).toBeLessThan(rankColumn("No status", null, null, null));
  });

  it("No status is always pinned last regardless of tier presence", () => {
    const config = new Map([["No status", 0]]);
    const ds = new Map([["No status", 0]]);
    const view = new Map([["No status", 0]]);
    expect(rankColumn("No status", config, view, ds)).toBe(Number.POSITIVE_INFINITY);
    expect(rankColumn("Done", config, view, ds)).toBeLessThan(
      rankColumn("No status", config, view, ds),
    );
  });

  it("within the config tier, smaller index wins", () => {
    const config = new Map([
      ["A", 0],
      ["B", 1],
      ["C", 2],
    ]);
    expect(rankColumn("A", config, null, null)).toBeLessThan(rankColumn("B", config, null, null));
    expect(rankColumn("B", config, null, null)).toBeLessThan(rankColumn("C", config, null, null));
  });

  it("within the view tier, smaller index wins", () => {
    const view = new Map([
      ["A", 0],
      ["B", 1],
    ]);
    expect(rankColumn("A", null, view, null)).toBeLessThan(rankColumn("B", null, view, null));
  });

  it("within the dataSource tier, smaller index wins", () => {
    const ds = new Map([
      ["A", 0],
      ["B", 1],
    ]);
    expect(rankColumn("A", null, null, ds)).toBeLessThan(rankColumn("B", null, null, ds));
  });

  it("a name absent from config falls through to dataSource", () => {
    const config = new Map([["Done", 0]]);
    const ds = new Map([
      ["Todo", 0],
      ["Done", 1],
    ]);
    expect(rankColumn("Done", config, null, ds)).toBeLessThan(rankColumn("Todo", config, null, ds));
  });

  it("unknown names sort STRICTLY before NO_STATUS", () => {
    expect(rankColumn("Whatever", null, null, null)).toBeLessThan(
      rankColumn("No status", null, null, null),
    );
    const config = new Map([["Done", 0]]);
    const ds = new Map([["Todo", 0]]);
    expect(rankColumn("Whatever", config, null, ds)).toBeLessThan(
      rankColumn("No status", config, null, ds),
    );
  });
});
