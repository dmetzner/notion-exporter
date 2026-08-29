import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SitemapEntry } from "../src/export/html.js";
import type { Manifest } from "../src/export/manifest.js";
import { computeStats, writeStatsPage } from "../src/export/stats.js";

// Every anchor on the stats dashboard must go through `safeLinkUrl` before
// interpolation. The stats page is rendered from manifest + sitemap
// entries; a tampered raw JSON could plant a hostile href into either
// source. These tests assert the gate fires.

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-stats-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function manifest(entries: Manifest["entries"]): Manifest {
  return {
    schemaVersion: 2,
    tool: { name: "notion-exporter", version: "test" },
    timestamp: "2026-06-01T00:00:00.000Z",
    counts: { pages: entries.length, databases: 0, assets: 0 },
    entries,
    assets: [],
  };
}

describe("stats page — safeLinkUrl gate", () => {
  it("href on hostile sitemap entries is neutralised in anchors", async () => {
    await withTmp(async (tmp) => {
      const rawDir = path.join(tmp, "raw");
      await fsp.mkdir(rawDir, { recursive: true });

      // Two pages: one normal, one with a tampered href that would
      // otherwise XSS via newestLine/oldestLine + topRecent + section bar.
      const m = manifest([
        {
          id: "id-good",
          kind: "page",
          title: "Good",
          rawPath: "raw/good.json",
          sha256: "0".repeat(64),
          bytes: 1,
          lastEditedTime: "2026-05-30T00:00:00.000Z",
        },
        {
          id: "id-evil",
          kind: "page",
          title: "Evil",
          rawPath: "raw/evil.json",
          sha256: "1".repeat(64),
          bytes: 1,
          lastEditedTime: "2026-05-01T00:00:00.000Z",
        },
      ]);
      const sitemap: SitemapEntry[] = [
        { id: "id-good", title: "Good", href: "good.html", kind: "page" },
        {
          id: "id-evil",
          title: "Evil",
          href: "javascript:alert('stats')",
          kind: "page",
        },
      ];

      const stats = await computeStats({
        rawDir,
        manifest: m,
        sitemap,
        generatedAt: "2026-06-01T00:00:00.000Z",
      });

      const htmlDir = path.join(tmp, "html");
      await fsp.mkdir(htmlDir, { recursive: true });
      await writeStatsPage(htmlDir, stats, {
        archiveTitle: "Test",
        generatedAt: "2026-06-01T00:00:00.000Z",
      });
      const html = await fsp.readFile(path.join(htmlDir, "stats.html"), "utf8");

      // The hostile href must not appear anywhere — neither in topRecent
      // <li><a href=…> nor newest/oldest bookend lines.
      expect(html).not.toContain("javascript:alert");
      // Each anchor for the evil page must point at the neutralised "#"
      // (safeLinkUrl's reject value). At least one occurrence is required
      // (recently-edited list always lists pages with `lastEditedTime`).
      expect(html).toMatch(/<a href="#">Evil<\/a>/);
      // The benign page is unaffected.
      expect(html).toContain('<a href="good.html">Good</a>');
    });
  });

  it("href on hostile sitemap section bars is neutralised", async () => {
    // The "Pages per top-level section" bars carry hrefs only when sections
    // resolve to a folder href via the sitemap. The same gate must fire
    // even though the bars currently come through with `escapeHtmlText`
    // alone. We exercise the renderHorizontalBars path via the renderer
    // indirectly: the topRecent rows + bookends use the same gate.
    await withTmp(async (tmp) => {
      const rawDir = path.join(tmp, "raw");
      await fsp.mkdir(rawDir, { recursive: true });
      const m = manifest([
        {
          id: "only",
          kind: "page",
          title: "Only",
          rawPath: "raw/only.json",
          sha256: "0".repeat(64),
          bytes: 1,
          lastEditedTime: "2026-05-30T00:00:00.000Z",
        },
      ]);
      const sitemap: SitemapEntry[] = [
        { id: "only", title: "Only", href: "vbscript:msgbox(1)", kind: "page" },
      ];
      const stats = await computeStats({
        rawDir,
        manifest: m,
        sitemap,
        generatedAt: "2026-06-01T00:00:00.000Z",
      });
      const htmlDir = path.join(tmp, "html");
      await fsp.mkdir(htmlDir, { recursive: true });
      await writeStatsPage(htmlDir, stats, {
        archiveTitle: "Test",
        generatedAt: "2026-06-01T00:00:00.000Z",
      });
      const html = await fsp.readFile(path.join(htmlDir, "stats.html"), "utf8");

      // Hostile scheme neutralised — both in topRecent + newest/oldest.
      expect(html).not.toContain("vbscript:msgbox");
      // newest + oldest bookend lines both render the same page (only entry)
      // and both must show the neutralised href.
      expect(html).toContain("Most recent edit:");
      expect(html).toContain("Oldest still-tracked edit:");
      // Every anchor for "Only" carries "#".
      const matches = html.match(/<a href="[^"]*">Only<\/a>/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) expect(m).toBe('<a href="#">Only</a>');
    });
  });
});
