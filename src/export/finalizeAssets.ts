import { writeKatexCss, writeLightboxJs, writeLunr, writeSearchJs } from "./clientAssets.js";
import { injectSidebars, type SitemapEntry, writeSitemap, writeStylesheet } from "./html.js";
import type { Manifest } from "./manifest.js";
import {
  buildSearchIndex,
  type SearchDoc,
  writeSearchBodies,
  writeSearchIndex,
} from "./searchIndex.js";
import { computeStats, writeStatsPage } from "./stats.js";

/**
 * Single source of truth for the static client-asset finalize step.
 *
 * Every command that emits HTML (export / rerender / repair) used to call
 * `writeStylesheet` + the four `clientAssets` writers independently, in
 * slightly different groupings and orders. That is exactly the shape that once
 * shipped repaired exports referencing a missing `katex.min.css` /
 * search-index (CLAUDE.md invariant #10): a new client asset added to one
 * command's finalize but not another's silently ships in one and breaks in the
 * rest. Funnelling all five static writers through here means a new asset is
 * added once and every command picks it up.
 *
 * The search-index *data* (`writeSearchIndex`) is intentionally NOT bundled
 * here — it depends on each run's collected search docs, so callers build the
 * payload and write it themselves.
 */
export async function finalizeClientAssets(htmlDir: string): Promise<void> {
  await Promise.all([
    writeStylesheet(htmlDir),
    writeLunr(htmlDir),
    writeSearchJs(htmlDir),
    writeLightboxJs(htmlDir),
    writeKatexCss(htmlDir),
  ]);
}

export interface FinalizeSiteArgs {
  /** HTML output dir (`paths.html`). */
  htmlDir: string;
  /** Raw JSON dir (`paths.raw`) — `computeStats` reads it. */
  rawDir: string;
  /** Sitemap entries; mutate titleHtml etc. *before* calling. */
  sitemap: SitemapEntry[];
  /** Per-doc search payload for this run. */
  searchDocs: SearchDoc[];
  /**
   * Wall-clock timestamp threaded into sitemap footer + stats page. Export and
   * rerender pass a fresh `exportTimestamp`; repair preserves `manifest.timestamp`
   * (CLAUDE.md invariant #11).
   */
  timestamp: string;
  archiveTitle: string;
  archiveIcon: string;
  /**
   * Persist the manifest and return the in-memory `Manifest` to feed
   * `computeStats`. The body varies per command (export: `writeManifest`;
   * rerender: timestamp-only rewrite; repair: `writeRepairedManifest` +
   * side-band still-failing count), so it stays a caller-supplied callback —
   * everything around it is identical and lives here. Invoked between
   * `writeSitemap` and `computeStats`, matching the original interleave.
   */
  persistManifest: () => Promise<Manifest>;
}

/**
 * The HTML finalize sequence shared by export / rerender / repair:
 * client assets → search index + bodies → sitemap → manifest → stats → sidebar.
 *
 * The three commands ran byte-identical copies of this with only the manifest
 * write differing; drift here is the same regression class as invariant #10
 * (one command ships a finalize step another lacks). Funnelling the sequence
 * through one function makes the order and set of writers a single edit.
 * `injectSidebars` runs last so `stats.html` (written just above) is patched too.
 */
export async function finalizeSite(args: FinalizeSiteArgs): Promise<Manifest> {
  const { htmlDir, rawDir, sitemap, searchDocs, timestamp, archiveTitle, archiveIcon } = args;
  await finalizeClientAssets(htmlDir);
  const searchPayload = buildSearchIndex(searchDocs);
  const searchIndexPath = await writeSearchIndex(htmlDir, searchPayload);
  // Sidecar with indexable body text per doc — repair reads this to avoid
  // re-reading every md off disk on asset-only refreshes.
  await writeSearchBodies(htmlDir, searchDocs);
  await writeSitemap(htmlDir, sitemap, timestamp, { searchIndexPath, archiveTitle, archiveIcon });

  const manifest = await args.persistManifest();

  const stats = await computeStats({ rawDir, manifest, sitemap, generatedAt: timestamp });
  await writeStatsPage(htmlDir, stats, { archiveTitle, archiveIcon, generatedAt: timestamp });
  await injectSidebars(htmlDir, sitemap, { extraFiles: ["stats.html"] });
  return manifest;
}
