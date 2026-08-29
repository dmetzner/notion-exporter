import { describe, expect, it, vi } from "vitest";
import { type DbViewConfig, parseDbConfig } from "../src/export/dbConfig.js";
import type { Logger } from "../src/logger.js";

function rt(text: string) {
  return { plain_text: text };
}

function fakeLog(): Logger & { warn: ReturnType<typeof vi.fn> } {
  // Only `warn` is exercised by parseDbConfig — stub the rest as no-ops so the
  // shape matches `Logger` without dragging pino into the test.
  const warn = vi.fn();
  const stub = {
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  return stub as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

describe("parseDbConfig", () => {
  it("returns {} when description has no fence (silent)", () => {
    const log = fakeLog();
    const db = {
      id: "db-1",
      description: [rt("Just a plain human-readable DB description.")],
    };
    expect(parseDbConfig(db, log)).toEqual({});
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("parses a fence with all supported keys set", () => {
    const log = fakeLog();
    const fence = [
      "Some prose first.",
      "",
      "%%notion-exporter",
      JSON.stringify({
        view: "kanban",
        groupBy: "Status",
        order: ["Nicht begonnen", "In Bearbeitung", "Erledigt"],
        hideFilters: true,
        cardMeta: ["Owner", "Due"],
      }),
      "%%",
    ].join("\n");
    const db = { id: "db-2", description: [rt(fence)] };
    const expected: DbViewConfig = {
      view: "kanban",
      groupBy: "Status",
      order: ["Nicht begonnen", "In Bearbeitung", "Erledigt"],
      hideFilters: true,
      cardMeta: ["Owner", "Due"],
    };
    expect(parseDbConfig(db, log)).toEqual(expected);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("drops invalid `view` value, keeps the rest, and warns", () => {
    const log = fakeLog();
    const fence = [
      "%%notion-exporter",
      JSON.stringify({ view: "invalid", groupBy: "Status", hideFilters: true }),
      "%%",
    ].join("\n");
    const db = { id: "db-3", description: [rt(fence)] };
    const cfg = parseDbConfig(db, log);
    expect(cfg).toEqual({ groupBy: "Status", hideFilters: true });
    expect(cfg.view).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const args = log.warn.mock.calls[0];
    expect(JSON.stringify(args)).toMatch(/view/);
  });

  it("returns {} on malformed JSON and warns with a JSON hint", () => {
    const log = fakeLog();
    const fence = ["%%notion-exporter", "view: kanban", "groupBy: Status", "%%"].join("\n");
    const db = { id: "db-4", description: [rt(fence)] };
    expect(parseDbConfig(db, log)).toEqual({});
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls[0])).toMatch(/JSON/);
  });

  it("uses the first fence when two are present", () => {
    const log = fakeLog();
    const fence = [
      "%%notion-exporter",
      JSON.stringify({ view: "kanban" }),
      "%%",
      "",
      "later text",
      "",
      "%%notion-exporter",
      JSON.stringify({ view: "table" }),
      "%%",
    ].join("\n");
    const db = { id: "db-5", description: [rt(fence)] };
    expect(parseDbConfig(db, log)).toEqual({ view: "kanban" });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("concatenates multiple rich_text segments before scanning", () => {
    const log = fakeLog();
    // Notion often splits a single paragraph into multiple rich_text items
    // (annotation boundaries, links, mentions). The fence might straddle them.
    const db = {
      id: "db-6",
      description: [
        rt("Human description.\n\n%%notion-exporter\n"),
        rt('{"view":"gallery",'),
        rt('"cardMeta":["Tags"]}'),
        rt("\n%%\n"),
      ],
    };
    expect(parseDbConfig(db, log)).toEqual({ view: "gallery", cardMeta: ["Tags"] });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
