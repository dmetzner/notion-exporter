import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Configurable per-page icon overrides for `pages.retrieve`. Tests can stash
// a fresh icon payload here so the page-icon refresh path inside repair sees
// a non-empty `fresh.icon` and downloads the asset.
const PAGE_RETRIEVE_OVERRIDES = new Map<string, { icon?: unknown }>();

// Notion SDK mock for the asset-refresh path. Repair calls
// `notion.blocks.retrieve` for each media block whose `local_path` is missing
// — we hand it back a fresh URL so the asset collector can download.
vi.mock("@notionhq/client", () => {
  class Client {
    pages = {
      retrieve: vi.fn(async ({ page_id }: { page_id: string }) => ({
        id: page_id,
        ...(PAGE_RETRIEVE_OVERRIDES.get(page_id) ?? {}),
      })),
    };
    blocks = {
      retrieve: vi.fn(async ({ block_id }: { block_id: string }) => ({
        id: block_id,
        type: "image",
        has_children: false,
        image: {
          type: "file",
          file: { url: "https://signed.example/refreshed.png", expiry_time: "x" },
        },
      })),
      children: {
        list: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
      },
    };
    databases = { retrieve: vi.fn() };
    dataSources = { query: vi.fn() };
    search = vi.fn();
    users = { me: vi.fn(async () => ({ id: "u", type: "bot" })) };
    comments = {
      list: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
    };
  }
  return { Client };
});

import { runRepair } from "../src/commands/repair.js";
import { loadConfig } from "../src/config.js";
import { MANIFEST_SCHEMA_VERSION, type Manifest } from "../src/export/manifest.js";
import { createLogger } from "../src/logger.js";

describe("repair orchestrator", () => {
  it("renders icons on cross-page links and resolves archiveIcon from a URL on repaired pages", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-repair-"));
    const origFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
        },
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
        },
      }) as unknown as Response) as unknown as typeof fetch;

    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      const rawDir = path.join(root, "raw");
      await fsp.mkdir(path.join(rawDir, "pages"), { recursive: true });
      await fsp.mkdir(path.join(rawDir, "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      const parentId = "00000000-0000-0000-0000-00000000aaaa";
      const childId = "00000000-0000-0000-0000-00000000bbbb";

      // Parent has a media block with no local_path — that triggers the repair
      // refresh path. It also mentions the child via rich_text so we can check
      // that resolveLink emits the child's icon glyph on the *repaired* page
      // (pageIcons short-circuit correctness).
      const parentRaw = {
        page: {
          id: parentId,
          object: "page",
          icon: { type: "emoji", emoji: "📦" },
          url: "https://notion.so/parent",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Parent" }] } },
        },
        blocks: [
          {
            id: "block-1",
            type: "link_to_page",
            has_children: false,
            link_to_page: { type: "page_id", page_id: childId },
          },
          {
            id: "block-2",
            type: "image",
            has_children: false,
            image: {
              type: "file",
              // URL present, local_path absent → triggers refresh.
              file: { url: "https://signed.example/expired.png", expiry_time: "x" },
            },
          },
        ],
        comments: [],
      };

      const childRaw = {
        page: {
          id: childId,
          object: "page",
          icon: { type: "emoji", emoji: "🧪" },
          url: "https://notion.so/child",
          parent: { type: "page_id", page_id: parentId },
          properties: { Name: { type: "title", title: [{ plain_text: "Child" }] } },
        },
        blocks: [],
        comments: [],
      };

      await fsp.writeFile(
        path.join(rawDir, "pages", `Parent.${parentId}.json`),
        JSON.stringify(parentRaw, null, 2),
      );
      await fsp.writeFile(
        path.join(rawDir, "pages", `Child.${childId}.json`),
        JSON.stringify(childRaw, null, 2),
      );

      const manifest: Manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: 2, databases: 0, assets: 0 },
        entries: [
          {
            id: parentId,
            kind: "page",
            title: "Parent",
            rawPath: `raw/pages/Parent.${parentId}.json`,
            sha256: "0",
            bytes: 0,
          },
          {
            id: childId,
            kind: "page",
            title: "Child",
            rawPath: `raw/pages/Child.${childId}.json`,
            sha256: "0",
            bytes: 0,
            parentId,
          },
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      // EXPORT_ICON is a URL — proves resolveArchiveIcon ran in repair.ts and
      // the raw URL didn't leak into repaired pages.
      const cfg = loadConfig({
        NOTION_TOKEN: "secret_x",
        OUT_DIR: tmp,
        EXPORT_ICON: "https://example.com/icon.png",
        EXPORT_TITLE: "Test Archive",
      });
      const log = createLogger("error");

      const result = await runRepair(cfg, log, { exportRoot: root });
      expect(result.refreshed).toBeGreaterThan(0);

      // Parent gets re-rendered because the image was refreshed (dirty).
      const parentHtml = await fsp.readFile(
        path.join(root, "html", `Parent.${parentId}.html`),
        "utf8",
      );

      // (a) cross-page-link icon present on the repaired page — without the
      // pageIcons + rawPageById plumbing this regresses to absent icons.
      expect(parentHtml).toContain("🧪");
      expect(parentHtml).toContain(`Child.${childId}.html`);

      // (b) archiveIcon resolved to a local hash, not the raw URL.
      // The asset collector content-addresses to `assets/<sha>.png`.
      expect(parentHtml).not.toContain("https://example.com/icon.png");
      expect(parentHtml).toMatch(/assets\/[0-9a-f]+\.png/);

      // (c) Every static + dynamic client asset every HTML page references
      // must be present after repair finalize. A prior finalize only emitted
      // style.css + lightbox.js; if a partial fixture didn't already have
      // lunr/search/katex on disk, the resulting tree shipped broken.
      const htmlDir = path.join(root, "html");
      const expected = [
        "style.css",
        "katex.min.css",
        "lunr.min.js",
        "search.js",
        "search-index.js",
        "lightbox.js",
      ];
      for (const name of expected) {
        await expect(fsp.access(path.join(htmlDir, name))).resolves.toBeUndefined();
      }
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  // rerenderDirty hands the freshly-rendered md back to collectSearchDocs
  // so we don't re-read dirty pages off disk just to recompute their search
  // snippet. Verify by spying `fsp.open` and asserting
  // the dirty page's md file is never opened during the search-index rebuild
  // phase (it IS opened earlier when renderPage writes the md, but the
  // collectSearchDocs walk should not open it again).
  it("does not re-read a dirty page's md from disk when rebuilding search docs", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-repair-perf-"));
    const origFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
        },
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
        },
      }) as unknown as Response) as unknown as typeof fetch;

    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      const rawDir = path.join(root, "raw");
      await fsp.mkdir(path.join(rawDir, "pages"), { recursive: true });
      await fsp.mkdir(path.join(rawDir, "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      const dirtyId = "00000000-0000-0000-0000-00000000dddd";
      const cleanId = "00000000-0000-0000-0000-00000000cccc";

      // Dirty page: has an unresolved image so repair refreshes it.
      const dirtyRaw = {
        page: {
          id: dirtyId,
          object: "page",
          icon: { type: "emoji", emoji: "🔥" },
          url: "https://notion.so/dirty",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Dirty" }] } },
        },
        blocks: [
          {
            id: "block-1",
            type: "image",
            has_children: false,
            image: {
              type: "file",
              file: { url: "https://signed.example/expired.png", expiry_time: "x" },
            },
          },
        ],
        comments: [],
      };

      // Clean page: everything already resolved, nothing to repair.
      const cleanRaw = {
        page: {
          id: cleanId,
          object: "page",
          icon: { type: "emoji", emoji: "✅" },
          url: "https://notion.so/clean",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Clean" }] } },
        },
        blocks: [],
        comments: [],
      };

      await fsp.writeFile(
        path.join(rawDir, "pages", `Dirty.${dirtyId}.json`),
        JSON.stringify(dirtyRaw, null, 2),
      );
      await fsp.writeFile(
        path.join(rawDir, "pages", `Clean.${cleanId}.json`),
        JSON.stringify(cleanRaw, null, 2),
      );

      // Pre-populate the markdown directory with the on-disk md for both
      // pages — repair walks markdown/ when collecting search docs, so the
      // dirty page's md must exist on disk for the test premise to be valid
      // (we'd otherwise miss its entry entirely, not "skip the read"). The
      // dirty md is rewritten by renderPage during rerenderDirty; the clean
      // md is untouched (repair never re-renders it).
      const dirtyMdPath = path.join(root, "markdown", `Dirty.${dirtyId}.md`);
      const cleanMdPath = path.join(root, "markdown", `Clean.${cleanId}.md`);
      await fsp.writeFile(dirtyMdPath, "# Dirty (stale)\n");
      await fsp.writeFile(cleanMdPath, "# Clean (snippet)\n");

      const { MANIFEST_SCHEMA_VERSION } = await import("../src/export/manifest.js");
      const manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: 2, databases: 0, assets: 0 },
        entries: [
          {
            id: dirtyId,
            kind: "page" as const,
            title: "Dirty",
            rawPath: `raw/pages/Dirty.${dirtyId}.json`,
            sha256: "0",
            bytes: 0,
          },
          {
            id: cleanId,
            kind: "page" as const,
            title: "Clean",
            rawPath: `raw/pages/Clean.${cleanId}.json`,
            sha256: "0",
            bytes: 0,
          },
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      const cfg = (await import("../src/config.js")).loadConfig({
        NOTION_TOKEN: "secret_x",
        OUT_DIR: tmp,
      });
      const log = (await import("../src/logger.js")).createLogger("error");

      // Spy on fsp.open so we can count opens of the dirty page's md after
      // the renderPage write. Sentinel marks the boundary between the
      // rerender phase (which writes the md) and the collectSearchDocs
      // phase (which must NOT re-open it for dirty pages).
      const openSpy = vi.spyOn(fsp, "open");

      const { runRepair } = await import("../src/commands/repair.js");
      const result = await runRepair(cfg, log, { exportRoot: root });
      expect(result.refreshed).toBeGreaterThan(0);

      // Tally distinct read-paths opened against the dirty page's md.
      // The flow opens it exactly ONCE during the search-index walk only
      // when our optimization is absent: that's the regression we forbid.
      // The renderPage writer uses fsp.writeFile (not fsp.open), so this
      // spy only catches READ-side opens of the file.
      const opensForDirtyMd = openSpy.mock.calls.filter((args) => {
        const arg0 = args[0];
        if (typeof arg0 !== "string") return false;
        return arg0 === dirtyMdPath || arg0.endsWith(`Dirty.${dirtyId}.md`);
      });
      expect(opensForDirtyMd.length).toBe(0);

      // Sanity: the clean page's md IS read off disk during the walk.
      const opensForCleanMd = openSpy.mock.calls.filter((args) => {
        const arg0 = args[0];
        if (typeof arg0 !== "string") return false;
        return arg0 === cleanMdPath || arg0.endsWith(`Clean.${cleanId}.md`);
      });
      expect(opensForCleanMd.length).toBeGreaterThan(0);

      // And the search index reflects the FRESH body (re-rendered), not the
      // stale on-disk md we wrote above — proves we used the in-memory body.
      const searchIndex = await fsp.readFile(path.join(root, "html", "search-index.js"), "utf8");
      expect(searchIndex).not.toContain("Dirty (stale)");
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmp, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  // Regression: collectSearchDocs once computed `htmlRel` from `paths.html`
  // while walking `paths.markdown`, producing `../markdown/...` hrefs in the
  // rebuilt search index and 404'ing every click. Hrefs must be relative to
  // `paths.html` (where search-index.js lives) — i.e. derived from
  // `paths.markdown` with `.md` swapped for `.html`.
  it("emits hierarchy-relative hrefs in the rebuilt search index", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-repair-href-"));
    const origFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
        },
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
        },
      }) as unknown as Response) as unknown as typeof fetch;

    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      const rawDir = path.join(root, "raw");
      await fsp.mkdir(path.join(rawDir, "pages"), { recursive: true });
      await fsp.mkdir(path.join(rawDir, "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown", "Haus"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      // Two pages: a nested page and a dirty page (so collectSearchDocs runs).
      const nestedId = "00000000-0000-0000-0000-0000000000a1";
      const dirtyId = "00000000-0000-0000-0000-0000000000a2";

      const nestedRaw = {
        page: {
          id: nestedId,
          object: "page",
          icon: { type: "emoji", emoji: "🏠" },
          url: "https://notion.so/nested",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Foo" }] } },
        },
        blocks: [],
        comments: [],
      };
      const dirtyRaw = {
        page: {
          id: dirtyId,
          object: "page",
          icon: { type: "emoji", emoji: "🔥" },
          url: "https://notion.so/dirty",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Dirty" }] } },
        },
        blocks: [
          {
            id: "block-1",
            type: "image",
            has_children: false,
            image: {
              type: "file",
              file: { url: "https://signed.example/expired.png", expiry_time: "x" },
            },
          },
        ],
        comments: [],
      };

      await fsp.writeFile(
        path.join(rawDir, "pages", `Foo.${nestedId}.json`),
        JSON.stringify(nestedRaw, null, 2),
      );
      await fsp.writeFile(
        path.join(rawDir, "pages", `Dirty.${dirtyId}.json`),
        JSON.stringify(dirtyRaw, null, 2),
      );

      // The nested page's md sits under markdown/Haus/Foo.<uuid>.md, mirroring
      // how export lays out a child-of-parent hierarchy on disk.
      await fsp.writeFile(path.join(root, "markdown", "Haus", `Foo.${nestedId}.md`), "# Foo\n");
      // Dirty page lives at the root of markdown/ (repair re-renders it).
      await fsp.writeFile(path.join(root, "markdown", `Dirty.${dirtyId}.md`), "# Dirty (stale)\n");

      const manifest: Manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: 2, databases: 0, assets: 0 },
        entries: [
          {
            id: nestedId,
            kind: "page",
            title: "Foo",
            rawPath: `raw/pages/Foo.${nestedId}.json`,
            sha256: "0",
            bytes: 0,
          },
          {
            id: dirtyId,
            kind: "page",
            title: "Dirty",
            rawPath: `raw/pages/Dirty.${dirtyId}.json`,
            sha256: "0",
            bytes: 0,
          },
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
      const log = createLogger("error");

      const result = await runRepair(cfg, log, { exportRoot: root });
      expect(result.refreshed).toBeGreaterThan(0);

      // Parse the rebuilt search-index.js payload. The writer emits a JSON
      // payload assigned to `window.NE_SEARCH_DATA` keyed by doc id
      // (`searchIndex.ts:writeSearchIndex`).
      const indexJs = await fsp.readFile(path.join(root, "html", "search-index.js"), "utf8");
      const match = indexJs.match(/window\.NE_SEARCH_DATA=(\{[\s\S]*\});\s*$/);
      expect(match).not.toBeNull();
      const payload = JSON.parse(match![1]) as {
        docs: Record<string, { href: string }>;
      };
      const nestedDoc = payload.docs[nestedId];
      expect(nestedDoc).toBeDefined();
      expect(nestedDoc.href).toBe(`Haus/Foo.${nestedId}.html`);
      // Negative: the pre-fix bug produced `../markdown/Haus/...` hrefs.
      expect(nestedDoc.href).not.toContain("../markdown/");
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  // Regression: a repaired page's icon refresh once updated only the page's
  // own header; every OTHER page's left-rail sidebar entry for that page
  // kept rendering the stale icon (or 📄 fallback) until a full re-export.
  // Repair finalize must rebuild the sitemap from the refreshed manifest +
  // raw and re-stamp every page's sidebar via injectSidebars.
  it("propagates a refreshed icon into neighbouring pages' sidebars", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-repair-sidebar-"));
    const origFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
        },
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
        },
      }) as unknown as Response) as unknown as typeof fetch;

    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      const rawDir = path.join(root, "raw");
      await fsp.mkdir(path.join(rawDir, "pages"), { recursive: true });
      await fsp.mkdir(path.join(rawDir, "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      const pageAId = "00000000-0000-0000-0000-0000000000a1";
      const pageBId = "00000000-0000-0000-0000-0000000000b2";
      const staleIconUrl = "https://signed.example/stale-icon.png";
      const freshIconUrl = "https://signed.example/fresh-icon.png";

      // Page A's icon has a URL but no local_path → triggers icon refresh.
      const pageARaw = {
        page: {
          id: pageAId,
          object: "page",
          icon: {
            type: "file",
            file: { url: staleIconUrl, expiry_time: "x" },
          },
          url: "https://notion.so/a",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Alpha" }] } },
        },
        blocks: [],
        comments: [],
      };
      // Page B is clean: nothing to repair on it. Its sidebar entry for
      // Page A must still pick up Page A's new local_path icon.
      const pageBRaw = {
        page: {
          id: pageBId,
          object: "page",
          icon: { type: "emoji", emoji: "🅱️" },
          url: "https://notion.so/b",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Beta" }] } },
        },
        blocks: [],
        comments: [],
      };

      await fsp.writeFile(
        path.join(rawDir, "pages", `Alpha.${pageAId}.json`),
        JSON.stringify(pageARaw, null, 2),
      );
      await fsp.writeFile(
        path.join(rawDir, "pages", `Beta.${pageBId}.json`),
        JSON.stringify(pageBRaw, null, 2),
      );
      // Page B's md must exist on disk so collectSearchDocs picks it up;
      // its html will be (re)stamped by injectSidebars.
      await fsp.writeFile(path.join(root, "markdown", `Beta.${pageBId}.md`), "# Beta\n");
      // Page B's html must exist for injectSidebars to rewrite — it walks
      // sitemap entries and writes back when the `<!--NE_SIDEBAR-->` marker
      // is present. Seed a minimal shell carrying that marker.
      await fsp.writeFile(
        path.join(root, "html", `Beta.${pageBId}.html`),
        "<!doctype html><html><body><nav><!--NE_SIDEBAR--></nav><main></main></body></html>",
      );

      const manifest: Manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: 2, databases: 0, assets: 0 },
        entries: [
          {
            id: pageAId,
            kind: "page",
            title: "Alpha",
            rawPath: `raw/pages/Alpha.${pageAId}.json`,
            sha256: "0",
            bytes: 0,
          },
          {
            id: pageBId,
            kind: "page",
            title: "Beta",
            rawPath: `raw/pages/Beta.${pageBId}.json`,
            sha256: "0",
            bytes: 0,
          },
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      // Wire the mock so `pages.retrieve(pageAId)` returns a fresh icon
      // payload — without this the refresh path returns null.
      PAGE_RETRIEVE_OVERRIDES.set(pageAId, {
        icon: { type: "file", file: { url: freshIconUrl, expiry_time: "y" } },
      });

      const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
      const log = createLogger("error");

      const result = await runRepair(cfg, log, { exportRoot: root });
      expect(result.refreshed).toBeGreaterThan(0);

      const betaHtml = await fsp.readFile(path.join(root, "html", `Beta.${pageBId}.html`), "utf8");
      // Sidebar must reference Page A's NEW local asset path. injectSidebars
      // rewrites root-relative `assets/<hash>.png` to depth-relative
      // `../assets/...` — Beta sits at depth 0 so the rewritten src is
      // `assets/<hash>.png`.
      expect(betaHtml).toMatch(/href="Alpha\.[^"]+\.html"/);
      expect(betaHtml).toMatch(/assets\/[0-9a-f]+\.png/);
      // Negative: the stale URL must NOT leak into the sidebar.
      expect(betaHtml).not.toContain(staleIconUrl);
      expect(betaHtml).not.toContain(freshIconUrl);

      PAGE_RETRIEVE_OVERRIDES.clear();
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmp, { recursive: true, force: true });
      PAGE_RETRIEVE_OVERRIDES.clear();
    }
  });

  // Repair must skip the disk read for CLEAN entries when a previous run's
  // `search-bodies.json` sidecar exists. Sidecar carries the indexable
  // plainText body per id; clean entries reuse it verbatim, turning ~940
  // reads on a 941-page workspace into 0 reads.
  it("skips disk reads for clean entries when search-bodies.json sidecar exists", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-repair-sidecar-"));
    const origFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
        },
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
        },
      }) as unknown as Response) as unknown as typeof fetch;

    try {
      const stamp = "2025-01-02T00-00-00Z";
      const root = path.join(tmp, stamp);
      const rawDir = path.join(root, "raw");
      await fsp.mkdir(path.join(rawDir, "pages"), { recursive: true });
      await fsp.mkdir(path.join(rawDir, "databases"), { recursive: true });
      await fsp.mkdir(path.join(root, "assets"), { recursive: true });
      await fsp.mkdir(path.join(root, "markdown"), { recursive: true });
      await fsp.mkdir(path.join(root, "html"), { recursive: true });

      const dirtyId = "00000000-0000-0000-0000-00000000d1d1";
      const cleanIds = Array.from(
        { length: 5 },
        (_, i) => `00000000-0000-0000-0000-${i.toString(16).padStart(8, "0")}cccc`,
      );

      const dirtyRaw = {
        page: {
          id: dirtyId,
          object: "page",
          icon: { type: "emoji", emoji: "🔥" },
          url: "https://notion.so/dirty",
          parent: { type: "workspace", workspace: true },
          properties: { Name: { type: "title", title: [{ plain_text: "Dirty" }] } },
        },
        blocks: [
          {
            id: "block-1",
            type: "image",
            has_children: false,
            image: {
              type: "file",
              file: { url: "https://signed.example/expired.png", expiry_time: "x" },
            },
          },
        ],
        comments: [],
      };
      await fsp.writeFile(
        path.join(rawDir, "pages", `Dirty.${dirtyId}.json`),
        JSON.stringify(dirtyRaw, null, 2),
      );
      await fsp.writeFile(path.join(root, "markdown", `Dirty.${dirtyId}.md`), "# Dirty\n");

      const cleanMdPaths: string[] = [];
      for (const cid of cleanIds) {
        const cleanRaw = {
          page: {
            id: cid,
            object: "page",
            icon: { type: "emoji", emoji: "✅" },
            url: `https://notion.so/${cid}`,
            parent: { type: "workspace", workspace: true },
            properties: { Name: { type: "title", title: [{ plain_text: `Clean-${cid}` }] } },
          },
          blocks: [],
          comments: [],
        };
        await fsp.writeFile(
          path.join(rawDir, "pages", `Clean.${cid}.json`),
          JSON.stringify(cleanRaw, null, 2),
        );
        const mdPath = path.join(root, "markdown", `Clean.${cid}.md`);
        await fsp.writeFile(mdPath, `# Clean ${cid}\n\nbody for ${cid}\n`);
        cleanMdPaths.push(mdPath);
      }

      // Seed the sidecar — simulates a prior export/rerender having run.
      const sidecar: Record<string, string> = {};
      for (const cid of cleanIds) sidecar[cid] = `# Clean ${cid} body for ${cid}`;
      // Dirty entry is also in the sidecar (stale), but freshBodies takes
      // priority so the rebuild reflects the fresh re-render.
      sidecar[dirtyId] = "# Dirty stale-snippet";
      await fsp.writeFile(path.join(root, "html", "search-bodies.json"), JSON.stringify(sidecar));

      const manifest: Manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tool: { name: "notion-exporter", version: "test" },
        timestamp: "2025-01-02T00:00:00.000Z",
        counts: { pages: cleanIds.length + 1, databases: 0, assets: 0 },
        entries: [
          {
            id: dirtyId,
            kind: "page",
            title: "Dirty",
            rawPath: `raw/pages/Dirty.${dirtyId}.json`,
            sha256: "0",
            bytes: 0,
          },
          ...cleanIds.map((cid) => ({
            id: cid,
            kind: "page" as const,
            title: `Clean-${cid}`,
            rawPath: `raw/pages/Clean.${cid}.json`,
            sha256: "0",
            bytes: 0,
          })),
        ],
        assets: [],
      };
      await fsp.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

      const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp });
      const log = createLogger("error");

      const openSpy = vi.spyOn(fsp, "open");
      const result = await runRepair(cfg, log, { exportRoot: root });
      expect(result.refreshed).toBeGreaterThan(0);

      // No clean entry's md is opened — they all came from the sidecar.
      for (const mdPath of cleanMdPaths) {
        const opens = openSpy.mock.calls.filter((args) => {
          const arg0 = args[0];
          return (
            typeof arg0 === "string" && (arg0 === mdPath || arg0.endsWith(path.basename(mdPath)))
          );
        });
        expect(opens.length).toBe(0);
      }

      // The rebuilt search index contains the sidecar snippets for clean
      // entries (proves we used the cached body, not a re-derivation).
      const idxJs = await fsp.readFile(path.join(root, "html", "search-index.js"), "utf8");
      const m = idxJs.match(/window\.NE_SEARCH_DATA=(\{[\s\S]*\});\s*$/);
      expect(m).not.toBeNull();
      const payload = JSON.parse(m![1]) as {
        docs: Record<string, { snippet: string; title: string }>;
      };
      // Clean entries hit the sidecar.
      for (const cid of cleanIds) {
        expect(payload.docs[cid]).toBeDefined();
        expect(payload.docs[cid].snippet).toContain(`Clean ${cid}`);
      }
      // Dirty entry uses the freshly-rendered body, NOT the stale sidecar.
      expect(payload.docs[dirtyId]).toBeDefined();
      expect(payload.docs[dirtyId].snippet).not.toContain("stale-snippet");

      // The sidecar is rewritten for the next repair cycle.
      const refreshed = JSON.parse(
        await fsp.readFile(path.join(root, "html", "search-bodies.json"), "utf8"),
      ) as Record<string, string>;
      expect(Object.keys(refreshed).length).toBe(cleanIds.length + 1);
      for (const cid of cleanIds) expect(refreshed[cid]).toContain(`Clean ${cid}`);
      expect(refreshed[dirtyId]).not.toContain("stale-snippet");
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmp, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
