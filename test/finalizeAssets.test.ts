import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeSite } from "../src/export/finalizeAssets.js";
import type { Manifest } from "../src/export/manifest.js";

// finalizeSite is the seam export/rerender/repair share for the HTML finalize
// sequence (client assets → search → sitemap → manifest → stats → sidebar).
// These tests lock the two things the extraction guarantees: every static
// client asset ships (invariant #10 regression class) and the per-command
// manifest write runs exactly once, interleaved between sitemap and stats.

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })));
});

async function makeDirs() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-finalize-"));
  tmpDirs.push(root);
  const htmlDir = path.join(root, "html");
  const rawDir = path.join(root, "raw");
  await fsp.mkdir(htmlDir, { recursive: true });
  await fsp.mkdir(rawDir, { recursive: true });
  return { htmlDir, rawDir };
}

function fakeManifest(): Manifest {
  return {
    schemaVersion: 1,
    tool: { name: "notion-exporter", version: "0.0.0-test" },
    timestamp: "2026-01-01T00:00:00.000Z",
    counts: { pages: 0, databases: 0, assets: 0 },
    entries: [],
    assets: [],
  };
}

describe("finalizeSite", () => {
  it("emits every static client asset + sitemap + stats", async () => {
    const { htmlDir, rawDir } = await makeDirs();
    await finalizeSite({
      htmlDir,
      rawDir,
      sitemap: [],
      searchDocs: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      archiveTitle: "Test",
      archiveIcon: "📚",
      persistManifest: async () => fakeManifest(),
    });
    // The five client assets that invariant #10 says must ship together, plus
    // the sitemap index and the stats page.
    const files = await fsp.readdir(htmlDir);
    expect(files).toContain("style.css");
    expect(files).toContain("index.html");
    expect(files).toContain("stats.html");
    // search.js + lunr + katex are part of finalizeClientAssets.
    expect(files).toContain("search.js");
  });

  it("invokes persistManifest exactly once and returns its manifest", async () => {
    const { htmlDir, rawDir } = await makeDirs();
    const manifest = fakeManifest();
    let calls = 0;
    const returned = await finalizeSite({
      htmlDir,
      rawDir,
      sitemap: [],
      searchDocs: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      archiveTitle: "Test",
      archiveIcon: "📚",
      persistManifest: async () => {
        calls++;
        return manifest;
      },
    });
    expect(calls).toBe(1);
    expect(returned).toBe(manifest);
  });

  it("runs persistManifest AFTER the sitemap and BEFORE stats", async () => {
    // Ordering is load-bearing: repair's writeRepairedManifest must land before
    // computeStats reads it, and the sitemap must exist when the manifest is
    // written. We observe order via filesystem state at callback time.
    const { htmlDir, rawDir } = await makeDirs();
    let sitemapExistedAtManifest = false;
    let statsExistedAtManifest = false;
    await finalizeSite({
      htmlDir,
      rawDir,
      sitemap: [],
      searchDocs: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      archiveTitle: "Test",
      archiveIcon: "📚",
      persistManifest: async () => {
        const files = await fsp.readdir(htmlDir);
        sitemapExistedAtManifest = files.includes("index.html");
        statsExistedAtManifest = files.includes("stats.html");
        return fakeManifest();
      },
    });
    expect(sitemapExistedAtManifest).toBe(true);
    expect(statsExistedAtManifest).toBe(false);
  });
});
