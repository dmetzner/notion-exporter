import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  cloneIncremental,
  enrichSitemapTitleHtml,
  type PhaseContext,
  rehydrateResume,
} from "../src/commands/export.js";
import { loadConfig } from "../src/config.js";
import type { Manifest } from "../src/export/manifest.js";
import { buildPaths } from "../src/export/paths.js";
import { createLogger } from "../src/logger.js";
import type { DiscoveredObject } from "../src/notion/crawl.js";

// Minimal ctx; helpers only touch a small slice — anything else is a no-op ref.
function makePhaseCtx(
  overrides: Partial<PhaseContext> & Pick<PhaseContext, "paths">,
): PhaseContext {
  const cfg = loadConfig({ NOTION_TOKEN: "x", OUT_DIR: "/tmp" });
  return {
    cfg,
    log: createLogger("error"),
    paths: overrides.paths,
    objects: [],
    byId: new Map(),
    hierarchy: new Map(),
    pageIndex: new Map(),
    childrenMap: new Map(),
    pageIcons: new Map(),
    assets: undefined as unknown as PhaseContext["assets"],
    skipIds: new Set(),
    manifestEntries: [],
    sitemap: [],
    searchDocs: [],
    carriedAssets: [],
    dbDataById: new Map(),
    customEmojiByName: new Map(),
    commentsDisabled: false,
    ...overrides,
  };
}

describe("A3 (HIGH XSS): enrichSitemapTitleHtml escapes the whole title", () => {
  it("escapes script-like payloads outside the :slug: match", () => {
    const customEmoji = new Map<string, string>([["smile", "assets/abcd.png"]]);
    const html = enrichSitemapTitleHtml("<script>alert(1)</script> :smile:", customEmoji);
    expect(html).not.toBeNull();
    // The script tags MUST be HTML-escaped — never interpolated raw.
    expect(html!).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html!).not.toMatch(/<script>/i);
    // The shortcode was swapped for an <img> with safe attribute values.
    expect(html!).toContain('<img class="custom-emoji"');
    expect(html!).toContain('src="assets/abcd.png"');
    expect(html!).toContain('alt="smile"');
  });

  it("escapes attribute-breaking characters like quotes and angle brackets", () => {
    const customEmoji = new Map<string, string>([["wave", "assets/wave.png"]]);
    const html = enrichSitemapTitleHtml(
      'Hello " onclick=alert(1) " :wave: <img src=x>',
      customEmoji,
    );
    expect(html).not.toBeNull();
    expect(html!).not.toContain('" onclick=alert(1) "');
    expect(html!).toContain("&quot;");
    expect(html!).toContain("&lt;img");
  });

  it("returns null when there are no shortcodes (caller leaves titleHtml unset)", () => {
    expect(enrichSitemapTitleHtml("plain title", new Map())).toBeNull();
  });

  it("leaves unknown shortcodes as escaped literal text", () => {
    const html = enrichSitemapTitleHtml(":unknown: <b>", new Map([["other", "assets/x.png"]]));
    // No matching emoji entry → no <img>, but the rest must still be escaped.
    expect(html).not.toBeNull();
    expect(html!).toContain("&lt;b&gt;");
    expect(html!).toContain(":unknown:");
  });
});

describe("A4 (MEDIUM): rehydrateResume refuses path-traversing filename stems", () => {
  it("skips raw JSON whose filename stem contains '..' (defense-in-depth)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-a4-traverse-"));
    try {
      const stamp = "2025-01-02T00-00-00Z";
      const paths = buildPaths(tmp, stamp);
      await fsp.mkdir(path.join(paths.raw, "pages"), { recursive: true });
      await fsp.mkdir(paths.markdown, { recursive: true });
      await fsp.mkdir(paths.html, { recursive: true });

      const id = "00000000-0000-0000-0000-0000000a11ce";
      // A tampered raw filename whose stem contains `..` — even if the OS
      // refuses literal `/` in a filename, the stem-based filename builder
      // in rehydrateResume must refuse the input rather than try to map it
      // to md/html paths under the markdown root.
      const tamperedName = `..%2F..%2Fetc%2Fpasswd.${id}.json`;
      await fsp.writeFile(
        path.join(paths.raw, "pages", tamperedName),
        JSON.stringify({ page: { id }, blocks: [] }),
      );

      const obj: DiscoveredObject = {
        id,
        object: "page",
        title: "Hello",
        parent: { type: "workspace" },
      };
      const byId = new Map<string, DiscoveredObject>([[id, obj]]);
      const ctx = makePhaseCtx({ paths, byId });
      await rehydrateResume(ctx);

      // The `..`-bearing stem must NOT produce a sitemap/manifest entry.
      expect(ctx.sitemap).toHaveLength(0);
      expect(ctx.manifestEntries).toHaveLength(0);
      expect(ctx.skipIds.size).toBe(0);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("accepts a normal stem (verifies the gate doesn't false-positive)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-a4-clean-"));
    try {
      const stamp = "2025-01-02T00-00-00Z";
      const paths = buildPaths(tmp, stamp);
      await fsp.mkdir(path.join(paths.raw, "pages"), { recursive: true });
      await fsp.mkdir(paths.markdown, { recursive: true });
      await fsp.mkdir(paths.html, { recursive: true });

      const id = "00000000-0000-0000-0000-0000000a11cf";
      const stem = `CleanTitle.${id}`;
      await fsp.writeFile(
        path.join(paths.raw, "pages", `${stem}.json`),
        JSON.stringify({ page: { id }, blocks: [] }),
      );

      const obj: DiscoveredObject = {
        id,
        object: "page",
        title: "CleanTitle",
        parent: { type: "workspace" },
      };
      const byId = new Map<string, DiscoveredObject>([[id, obj]]);
      const ctx = makePhaseCtx({ paths, byId });
      await rehydrateResume(ctx);
      expect(ctx.sitemap).toHaveLength(1);
      expect(ctx.skipIds.has(id)).toBe(true);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("#6 (MEDIUM SEC): cloneIncremental gates rawSrc with assertWithinRoot", () => {
  it("refuses a manifest rawPath that escapes the prev export root and refetches", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-6-traverse-"));
    try {
      const prevStamp = "2025-01-01T00-00-00Z";
      const curStamp = "2025-01-02T00-00-00Z";
      const prevPaths = buildPaths(tmp, prevStamp);
      const curPaths = buildPaths(tmp, curStamp);

      const id = "00000000-0000-0000-0000-000000000600";
      const title = "Page";
      // Stamp the prev tree skeleton so the helper's prevMdById/prevHtmlById
      // index walks don't blow up before reaching the rawSrc gate.
      await fsp.mkdir(path.join(prevPaths.raw, "pages"), { recursive: true });
      await fsp.mkdir(prevPaths.markdown, { recursive: true });
      await fsp.mkdir(prevPaths.html, { recursive: true });

      await fsp.mkdir(path.join(curPaths.raw, "pages"), { recursive: true });
      await fsp.mkdir(curPaths.markdown, { recursive: true });
      await fsp.mkdir(curPaths.html, { recursive: true });

      // Tampered manifest: rawPath traverses out of the prev export root.
      // `path.basename` of this string is a well-formed `<stem>.<uuid>.json`,
      // so the destination stem-validator on basename would accept it — only
      // the assertWithinRoot guard on the source side blocks the read.
      const tamperedRawPath = `../../../etc/passwd.${id}.json`;
      const prevManifest: Manifest = {
        schemaVersion: 2,
        tool: { name: "notion-exporter", version: "0.0.0" },
        timestamp: "prev",
        counts: { pages: 1, databases: 0, assets: 0 },
        entries: [
          {
            id,
            kind: "page",
            title,
            rawPath: tamperedRawPath,
            sha256: "deadbeef",
            bytes: 0,
            lastEditedTime: "2025-01-01T00:00:00Z",
          },
        ],
        assets: [],
      };

      const obj: DiscoveredObject = {
        id,
        object: "page",
        title,
        parent: { type: "workspace" },
        lastEditedTime: "2025-01-01T00:00:00Z",
      };
      const byId = new Map<string, DiscoveredObject>([[id, obj]]);
      const skipIds = new Set<string>([id]);
      const ctx = makePhaseCtx({ paths: curPaths, byId, skipIds });

      await cloneIncremental(ctx, { root: prevPaths.root, manifest: prevManifest });

      // The id was dropped from skipIds → fetch phase will refetch.
      expect(ctx.skipIds.has(id)).toBe(false);
      // Nothing was cloned: no manifest/sitemap entry pushed.
      expect(ctx.manifestEntries).toHaveLength(0);
      expect(ctx.sitemap).toHaveLength(0);
      // And no `passwd.<uuid>.json` file landed in the current raw/pages dir.
      const dest = path.join(curPaths.raw, "pages", `passwd.${id}.json`);
      await expect(fsp.access(dest)).rejects.toBeTruthy();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("B4 (MEDIUM): cloneIncremental uses the SOURCE raw filename stem", () => {
  it("clones md/html under the previous-export filename even after a rename", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-b4-rename-"));
    try {
      const prevStamp = "2025-01-01T00-00-00Z";
      const curStamp = "2025-01-02T00-00-00Z";
      const prevPaths = buildPaths(tmp, prevStamp);
      const curPaths = buildPaths(tmp, curStamp);

      const id = "00000000-0000-0000-0000-000000000b04";
      const oldName = "OldName";
      const newName = "NewName-after-rename";
      const oldStem = `${oldName}.${id}`;

      // Set up the prev export: raw/pages/<OldName>.<id>.json + matching md/html.
      await fsp.mkdir(path.join(prevPaths.raw, "pages"), { recursive: true });
      await fsp.mkdir(prevPaths.markdown, { recursive: true });
      await fsp.mkdir(prevPaths.html, { recursive: true });
      const prevRawAbs = path.join(prevPaths.raw, "pages", `${oldStem}.json`);
      await fsp.writeFile(prevRawAbs, JSON.stringify({ page: { id }, blocks: [] }));
      await fsp.writeFile(path.join(prevPaths.markdown, `${oldStem}.md`), "# OldName body");
      await fsp.writeFile(path.join(prevPaths.html, `${oldStem}.html`), "<html />");

      // Set up the current export's directories.
      await fsp.mkdir(path.join(curPaths.raw, "pages"), { recursive: true });
      await fsp.mkdir(curPaths.markdown, { recursive: true });
      await fsp.mkdir(curPaths.html, { recursive: true });

      // Build a minimal prev manifest pointing at the prev raw file.
      const prevManifest: Manifest = {
        schemaVersion: 2,
        tool: { name: "notion-exporter", version: "0.0.0" },
        timestamp: "prev",
        counts: { pages: 1, databases: 0, assets: 0 },
        entries: [
          {
            id,
            kind: "page",
            title: oldName,
            rawPath: path.relative(prevPaths.root, prevRawAbs),
            sha256: "deadbeef",
            bytes: 0,
            lastEditedTime: "2025-01-01T00:00:00Z",
          },
        ],
        assets: [],
      };

      // The current crawl carries the NEW title (rename happened upstream).
      const obj: DiscoveredObject = {
        id,
        object: "page",
        title: newName,
        parent: { type: "workspace" },
        lastEditedTime: "2025-01-01T00:00:00Z",
      };
      const byId = new Map<string, DiscoveredObject>([[id, obj]]);
      const skipIds = new Set<string>([id]);
      const ctx = makePhaseCtx({ paths: curPaths, byId, skipIds });

      await cloneIncremental(ctx, { root: prevPaths.root, manifest: prevManifest });

      // The clone MUST use the prev stem ("OldName.<id>"), not the new title,
      // so the md/html clones actually find their sources on disk.
      const expectedMd = path.join(curPaths.markdown, `${oldStem}.md`);
      const expectedHtml = path.join(curPaths.html, `${oldStem}.html`);
      const expectedRaw = path.join(curPaths.raw, "pages", `${oldStem}.json`);
      await expect(fsp.access(expectedRaw)).resolves.toBeUndefined();
      await expect(fsp.access(expectedMd)).resolves.toBeUndefined();
      await expect(fsp.access(expectedHtml)).resolves.toBeUndefined();

      // And the new-title-named files must NOT exist (we didn't clone there).
      const wrongMd = path.join(curPaths.markdown, `${newName}.${id}.md`);
      await expect(fsp.access(wrongMd)).rejects.toBeTruthy();

      // Manifest entry uses the (current) title for display but the rawAbs
      // points at the old-stem path on disk.
      expect(ctx.manifestEntries).toHaveLength(1);
      expect(ctx.manifestEntries[0]!.rawAbs).toBe(expectedRaw);
      expect(ctx.manifestEntries[0]!.title).toBe(newName);

      // Sitemap href is derived from the cloned htmlAbs → must point at the
      // file we actually wrote (old stem).
      expect(ctx.sitemap).toHaveLength(1);
      expect(ctx.sitemap[0]!.href).toBe(`${oldStem}.html`);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
