import { describe, expect, it } from "vitest";
import { loadConfig, requireToken } from "../src/config.js";

describe("config", () => {
  it("loads defaults", () => {
    const cfg = loadConfig({});
    expect(cfg.io.outDir).toBe("./exports");
    expect(cfg.io.retention).toBe(0);
    expect(cfg.log.level).toBe("info");
  });

  it("coerces numeric envs", () => {
    const cfg = loadConfig({ RETENTION: "5", ASSET_CONCURRENCY: "8" });
    expect(cfg.io.retention).toBe(5);
    expect(cfg.io.assetConcurrency).toBe(8);
  });

  it("requireToken throws when missing", () => {
    const cfg = loadConfig({});
    expect(() => requireToken(cfg)).toThrow(/NOTION_TOKEN/);
  });

  it("requireToken returns token when set", () => {
    const cfg = loadConfig({ NOTION_TOKEN: "secret_x" });
    expect(requireToken(cfg)).toBe("secret_x");
  });

  it("rejects invalid log level", () => {
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow();
  });

  it("groups parsed env into purpose-buckets", () => {
    const cfg = loadConfig({
      NOTION_TOKEN: "secret_x",
      OUT_DIR: "/tmp/out",
      RETENTION: "3",
      ASSET_CONCURRENCY: "12",
      PAGE_CONCURRENCY: "6",
      PRETTY_RAW_JSON: "false",
      NOTION_MIN_TIME: "200",
      NOTION_MAX_CONCURRENT: "5",
      NOTION_MAX_RETRIES: "9",
      CRAWL_CONCURRENCY: "10",
      EXPAND_CHILD_PAGES: "false",
      EXPORT_TITLE: "My archive",
      EXPORT_ICON: "🦊",
      EXPORT_ROW_MEDIA: "false",
      STYLE_BACK_LINKS: "true",
      LOG_LEVEL: "debug",
    });

    expect(cfg.token).toBe("secret_x");
    expect(cfg.io).toEqual({
      outDir: "/tmp/out",
      retention: 3,
      assetConcurrency: 12,
      pageConcurrency: 6,
      prettyRawJson: false,
    });
    expect(cfg.notion).toEqual({ minTime: 200, maxConcurrent: 5, maxRetries: 9 });
    expect(cfg.crawl).toEqual({ concurrency: 10, expandChildPages: false });
    expect(cfg.render).toEqual({
      exportTitle: "My archive",
      exportIcon: "🦊",
      rowMedia: false,
      backLinks: true,
      dbView: "auto",
    });
    expect(cfg.log).toEqual({ level: "debug" });
  });

  it("shape has no flat legacy keys", () => {
    const cfg = loadConfig({});
    // Belt-and-braces: ensure the old flat upper-snake keys are gone so any
    // missed callsite fails fast at the type checker rather than silently
    // reading `undefined` at runtime.
    expect(Object.keys(cfg).sort()).toEqual(
      ["crawl", "io", "log", "notion", "render", "token"].sort(),
    );
  });
});
