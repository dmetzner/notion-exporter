import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  KATEX_LICENSE_FILENAME,
  LIGHTBOX_JS,
  SEARCH_JS,
  writeKatexCss,
  writeLightboxJs,
} from "../src/export/clientAssets.js";

describe("clientAssets — LIGHTBOX_JS", () => {
  it("is a non-empty string", () => {
    expect(typeof LIGHTBOX_JS).toBe("string");
    expect(LIGHTBOX_JS.length).toBeGreaterThan(0);
  });

  it("uses native <dialog>.showModal + a delegated click listener", () => {
    expect(LIGHTBOX_JS).toContain("showModal");
    expect(LIGHTBOX_JS).toContain("addEventListener");
  });

  it("excludes UI glyphs so they never zoom", () => {
    // At least one of the excluded selectors must show up in the script;
    // we check the most distinctive ones individually.
    expect(LIGHTBOX_JS).toContain("custom-emoji");
    expect(LIGHTBOX_JS).toContain("sidebar-home-icon");
    expect(LIGHTBOX_JS).toContain("tree-icon");
    expect(LIGHTBOX_JS).toContain("data-no-zoom");
  });

  it("excludes page-icon so the H1 icon does not zoom", () => {
    expect(LIGHTBOX_JS).toContain(".page-icon");
  });

  // SEARCH_JS carries the type-aware DB filter logic. We can't exercise it
  // in a vitest-node environment without jsdom, so we assert on the wiring
  // strings that prove the behaviour is hooked up.
  it("SEARCH_JS wires up type-aware DB filter widgets", () => {
    expect(SEARCH_JS).toContain("data-filter-col");
    expect(SEARCH_JS).toContain("data-filter-type");
    expect(SEARCH_JS).toContain("db-filter-chip");
    expect(SEARCH_JS).toContain("data-filter-clear");
    expect(SEARCH_JS).toContain("data-empty-state");
    // URL hash sync — restores filters across refreshes.
    expect(SEARCH_JS).toContain("readHash");
    expect(SEARCH_JS).toContain("syncHash");
  });

  // Ship the upstream KaTeX LICENSE so the MIT "include this copyright
  // notice in all copies" clause is satisfied for both the CSS and the
  // font binaries we copy.
  it("writeKatexCss emits LICENSE-katex.txt next to katex.min.css", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-katex-"));
    try {
      await writeKatexCss(dir);
      const licenseAbs = path.join(dir, KATEX_LICENSE_FILENAME);
      const contents = await fsp.readFile(licenseAbs, "utf8");
      // Sanity-check we actually shipped MIT, not an empty file.
      expect(contents).toMatch(/MIT License/i);
      expect(contents).toMatch(/Khan Academy/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("writeLightboxJs writes the script next to the stylesheet", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-lightbox-"));
    try {
      const abs = await writeLightboxJs(dir);
      expect(abs).toBe(path.join(dir, "lightbox.js"));
      const contents = await fsp.readFile(abs, "utf8");
      expect(contents).toBe(LIGHTBOX_JS);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
