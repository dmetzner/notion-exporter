import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type PhaseContext, rehydrateResume } from "../src/commands/export.js";
import { loadConfig } from "../src/config.js";
import { buildPaths } from "../src/export/paths.js";
import { createLogger } from "../src/logger.js";
import type { DiscoveredObject } from "../src/notion/crawl.js";

// Minimal stand-in for the bits of PhaseContext rehydrateResume reads/writes.
// rehydrateResume only touches: paths, byId, hierarchy, pageIcons, skipIds,
// manifestEntries, sitemap, searchDocs, log — anything else can be a noop ref.
function makePhaseCtx(overrides: {
  paths: PhaseContext["paths"];
  byId: PhaseContext["byId"];
  hierarchy: PhaseContext["hierarchy"];
}): PhaseContext {
  const cfg = loadConfig({ NOTION_TOKEN: "x", OUT_DIR: "/tmp" });
  return {
    cfg,
    log: createLogger("error"),
    paths: overrides.paths,
    objects: [],
    byId: overrides.byId,
    hierarchy: overrides.hierarchy,
    pageIndex: new Map(),
    childrenMap: new Map(),
    pageIcons: new Map(),
    // The remaining fields are not consulted by rehydrateResume; cast through
    // unknown to avoid synthesising a full collector + dbDataById.
    assets: undefined as unknown as PhaseContext["assets"],
    skipIds: new Set(),
    manifestEntries: [],
    sitemap: [],
    searchDocs: [],
    carriedAssets: [],
    dbDataById: new Map(),
    customEmojiByName: new Map(),
    commentsDisabled: false,
  };
}

describe("rehydrateResume", () => {
  it("derives sitemap href from the on-disk filename stem, even when the title changed", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-resume-rename-"));
    try {
      const stamp = "2025-01-02T00-00-00Z";
      const paths = buildPaths(tmp, stamp);
      await fsp.mkdir(path.join(paths.raw, "pages"), { recursive: true });
      await fsp.mkdir(paths.markdown, { recursive: true });
      await fsp.mkdir(paths.html, { recursive: true });

      const id = "00000000-0000-0000-0000-00000000abcd";
      // On-disk filename uses the OLD title — the aborted run wrote
      // `OldName.<id>.{json,md,html}` before being killed.
      const oldStem = `OldName.${id}`;
      await fsp.writeFile(
        path.join(paths.raw, "pages", `${oldStem}.json`),
        JSON.stringify({ page: { id }, blocks: [] }),
      );
      await fsp.writeFile(path.join(paths.markdown, `${oldStem}.md`), "# OldName body");

      // ...but the resume's fresh crawl carries the NEW title (Notion's
      // current state). Before the fix this drove mdAbs/htmlAbs to a stem
      // that didn't exist on disk, sending sitemap href / manifest mdRel to
      // a 404.
      const obj: DiscoveredObject = {
        id,
        object: "page",
        title: "NewName",
        parent: { type: "workspace" },
      };
      const byId = new Map<string, DiscoveredObject>([[id, obj]]);
      const hierarchy = new Map<string, string>();

      const ctx = makePhaseCtx({ paths, byId, hierarchy });
      await rehydrateResume(ctx);

      expect(ctx.sitemap).toHaveLength(1);
      const entry = ctx.sitemap[0]!;
      // Href must point at the on-disk stem (OldName.<id>.html), NOT the
      // current-title stem (NewName.<id>.html).
      expect(entry.href).toBe(`${oldStem}.html`);
      expect(entry.href).not.toContain("NewName");

      // The md body was actually read (search doc populated from disk).
      expect(ctx.searchDocs).toHaveLength(1);
      expect(ctx.searchDocs[0]!.body).toContain("OldName body");

      // skipIds wired up so the fetch phase doesn't re-download.
      expect(ctx.skipIds.has(id)).toBe(true);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
