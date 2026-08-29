import { describe, expect, it } from "vitest";
import { buildPaths, safeSegment, timestampDir } from "../src/export/paths.js";

describe("paths", () => {
  it("timestamp dir has no colons/dots", () => {
    const t = timestampDir(new Date("2026-05-29T14:00:00.000Z"));
    expect(t).toBe("2026-05-29T14-00-00Z");
  });

  it("buildPaths returns expected subdirs", () => {
    const p = buildPaths("/out", "2026-05-29T14-00-00Z");
    expect(p.root).toBe("/out/2026-05-29T14-00-00Z");
    expect(p.raw.endsWith("raw")).toBe(true);
    expect(p.markdown.endsWith("markdown")).toBe(true);
    expect(p.html.endsWith("html")).toBe(true);
    expect(p.assets.endsWith("assets")).toBe(true);
    expect(p.manifest.endsWith("manifest.json")).toBe(true);
  });

  it("safeSegment strips invalid chars", () => {
    expect(safeSegment("a/b\\c:d")).toBe("a_b_c_d");
    expect(safeSegment("..")).toBe("untitled");
    expect(safeSegment("")).toBe("untitled");
    expect(safeSegment("  hello   world  ")).toBe("hello world");
  });

  it("safeSegment truncates over 120 chars", () => {
    const s = safeSegment("a".repeat(200));
    expect(s.length).toBe(120);
  });
});
