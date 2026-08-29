// Workspace statistics dashboard.
//
// Computed at finalize from raw page/DB JSON + manifest + sitemap, emitted as
// a standalone `stats.html` next to `index.html`. Tabular data is rendered as
// inline SVG (no chart-library dep — invariant: every new runtime dep is a
// maintenance promise) so the dashboard works fully offline.

import fsp from "node:fs/promises";
import path from "node:path";
import { type NotionBlock, walkBlocks } from "../notion/blocks.js";
import { renderChrome, type SitemapEntry } from "./html.js";
import { escapeHtmlText } from "./htmlEscape.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import { mdUrl, safeLinkUrl } from "./markdown/util.js";

export interface StatsBundle {
  totals: {
    pages: number;
    databases: number;
    dbRows: number;
    assets: number;
    assetBytes: number;
    rawBytes: number;
  };
  recent: { d7: number; d30: number; d90: number; d365: number };
  /** Last 24 months ending at `generatedAt`, oldest → newest. Empty months kept
   * so the bar chart shows the time axis honestly. */
  activityByMonth: Array<{ ym: string; count: number }>;
  /** Block type histogram across every page's block tree. Sorted desc, top 14
   * shown to the UI; the rest collapsed into "other". */
  blockTypes: Array<{ type: string; count: number }>;
  /** Top 12 most-recently-edited pages. */
  topRecent: Array<{ title: string; href: string; lastEdited: string }>;
  /** Pages per top-level section (first `/`-separated segment of href).
   * Hrefs without a slash are bucketed under "Top-level". */
  topSections: Array<{ section: string; count: number }>;
  newest: { title: string; href: string; date: string } | null;
  oldest: { title: string; href: string; date: string } | null;
}

interface ComputeStatsInput {
  rawDir: string;
  manifest: Manifest;
  sitemap: SitemapEntry[];
  generatedAt: string;
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86400_000).toISOString();
}

function trailingMonths(generatedAt: string, count: number): string[] {
  const out: string[] = [];
  const base = new Date(generatedAt);
  if (Number.isNaN(base.getTime())) return out;
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function computeStats(opts: ComputeStatsInput): Promise<StatsBundle> {
  const { rawDir, manifest, sitemap, generatedAt } = opts;

  const hrefById = new Map(sitemap.map((e) => [e.id, e.href] as const));
  const titleById = new Map(sitemap.map((e) => [e.id, e.title] as const));

  const pageEntries = manifest.entries.filter((e) => e.kind === "page");
  const dbEntries = manifest.entries.filter((e) => e.kind === "database");

  // Recent activity (counts) — also feeds the per-month histogram.
  const now = new Date(generatedAt);
  const cutoff7 = daysAgoIso(now, 7);
  const cutoff30 = daysAgoIso(now, 30);
  const cutoff90 = daysAgoIso(now, 90);
  const cutoff365 = daysAgoIso(now, 365);
  const recent = { d7: 0, d30: 0, d90: 0, d365: 0 };
  const monthBuckets = new Map<string, number>();
  for (const e of pageEntries) {
    const t = e.lastEditedTime;
    if (!t) continue;
    if (t >= cutoff365) recent.d365++;
    if (t >= cutoff90) recent.d90++;
    if (t >= cutoff30) recent.d30++;
    if (t >= cutoff7) recent.d7++;
    // YYYY-MM slice — stays in the timestamp's original zone offset, so a
    // 2026-01-01T00:30+02:00 edit lands in 2026-01 rather than 2025-12.
    const ym = t.slice(0, 7);
    monthBuckets.set(ym, (monthBuckets.get(ym) ?? 0) + 1);
  }
  const monthsToShow = trailingMonths(generatedAt, 24);
  const activityByMonth = monthsToShow.map((ym) => ({
    ym,
    count: monthBuckets.get(ym) ?? 0,
  }));

  // Top recent + newest/oldest from manifest (cheap — no raw reads needed).
  const datedPages = pageEntries
    .filter((e): e is ManifestEntry & { lastEditedTime: string } => !!e.lastEditedTime)
    .sort((a, b) => (a.lastEditedTime < b.lastEditedTime ? 1 : -1));
  const topRecent = datedPages.slice(0, 12).map((e) => ({
    title: titleById.get(e.id) ?? e.title,
    href: hrefById.get(e.id) ?? "",
    lastEdited: e.lastEditedTime,
  }));
  const newest = datedPages[0]
    ? {
        title: titleById.get(datedPages[0].id) ?? datedPages[0].title,
        href: hrefById.get(datedPages[0].id) ?? "",
        date: datedPages[0].lastEditedTime,
      }
    : null;
  const oldestEntry = datedPages[datedPages.length - 1];
  const oldest = oldestEntry
    ? {
        title: titleById.get(oldestEntry.id) ?? oldestEntry.title,
        href: hrefById.get(oldestEntry.id) ?? "",
        date: oldestEntry.lastEditedTime,
      }
    : null;

  // Top sections — bucket sitemap pages by the first href segment. Database
  // entries are skipped (they live as siblings of their parent page and would
  // double-count). Pages with no slash live at the top level.
  const sectionCounts = new Map<string, number>();
  for (const e of sitemap) {
    if (e.kind !== "page") continue;
    const slash = e.href.indexOf("/");
    if (slash === -1) {
      sectionCounts.set("(Top-level)", (sectionCounts.get("(Top-level)") ?? 0) + 1);
    } else {
      const seg = decodeURIComponent(e.href.slice(0, slash));
      sectionCounts.set(seg, (sectionCounts.get(seg) ?? 0) + 1);
    }
  }
  const topSections = [...sectionCounts.entries()]
    .map(([section, count]) => ({ section, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // DB row totals — read raw DB JSON. Each file is small (one DB's row list
  // is rarely >1MB); sequential is fine for the finalize phase.
  let dbRows = 0;
  for (const e of dbEntries) {
    const abs = path.join(rawDir, "..", e.rawPath);
    try {
      const text = await fsp.readFile(abs, "utf8");
      const j = JSON.parse(text) as { rows?: unknown[] };
      if (Array.isArray(j.rows)) dbRows += j.rows.length;
    } catch {
      // Skip unreadable raw files; counts degrade gracefully.
    }
  }

  // Block type distribution — walk every raw page JSON. Sequential reads
  // (parallel would race the disk on a large export; we're already in finalize
  // and the user is watching the progress line).
  const blockTypeCounts = new Map<string, number>();
  for (const e of pageEntries) {
    const abs = path.join(rawDir, "..", e.rawPath);
    try {
      const j = JSON.parse(await fsp.readFile(abs, "utf8")) as { blocks?: NotionBlock[] };
      if (Array.isArray(j.blocks)) {
        for (const b of walkBlocks(j.blocks)) {
          blockTypeCounts.set(b.type, (blockTypeCounts.get(b.type) ?? 0) + 1);
        }
      }
    } catch {
      // Skip unreadable; histogram degrades.
    }
  }
  // Raw JSON size — manifest already carries per-entry `bytes` so we don't
  // need to re-stat the files we just read.
  const rawBytes = manifest.entries.reduce((s, e) => s + (e.bytes ?? 0), 0);
  const blockTypesAll = [...blockTypeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  const TOP_N = 14;
  let blockTypes = blockTypesAll.slice(0, TOP_N);
  if (blockTypesAll.length > TOP_N) {
    const otherCount = blockTypesAll.slice(TOP_N).reduce((s, x) => s + x.count, 0);
    blockTypes = [...blockTypes, { type: "(other)", count: otherCount }];
  }

  // Asset totals from manifest. `assets` already excludes failures.
  const assetBytes = manifest.assets.reduce((s, a) => s + (a.bytes ?? 0), 0);

  return {
    totals: {
      pages: pageEntries.length,
      databases: dbEntries.length,
      dbRows,
      assets: manifest.assets.length,
      assetBytes,
      rawBytes,
    },
    recent,
    activityByMonth,
    blockTypes,
    topRecent,
    topSections,
    newest,
    oldest,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function renderActivityChart(months: Array<{ ym: string; count: number }>): string {
  const W = 760;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...months.map((m) => m.count));
  const barW = innerW / months.length;
  const gap = Math.max(1, barW * 0.18);
  const bars = months
    .map((m, i) => {
      const h = (m.count / max) * innerH;
      const x = PAD_L + i * barW + gap / 2;
      const y = PAD_T + innerH - h;
      const w = Math.max(1, barW - gap);
      const title = `${m.ym}: ${m.count} page${m.count === 1 ? "" : "s"} edited`;
      return `<g class="stats-bar"><rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="2"><title>${escapeHtmlText(title)}</title></rect></g>`;
    })
    .join("");
  // Label every 3rd month so the axis doesn't smear at 24 ticks.
  const labels = months
    .map((m, i) => {
      if (i % 3 !== 0 && i !== months.length - 1) return "";
      const x = PAD_L + i * barW + barW / 2;
      const y = H - PAD_B + 14;
      return `<text class="stats-axis" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle">${escapeHtmlText(m.ym)}</text>`;
    })
    .join("");
  // Y-axis: 0 and max ticks only — keeps the chart visually clean.
  const yTicks = `
    <text class="stats-axis" x="${PAD_L - 6}" y="${PAD_T + 4}" text-anchor="end">${max}</text>
    <text class="stats-axis" x="${PAD_L - 6}" y="${PAD_T + innerH + 4}" text-anchor="end">0</text>
    <line class="stats-axis-line" x1="${PAD_L}" y1="${PAD_T + innerH}" x2="${W - PAD_R}" y2="${PAD_T + innerH}"/>
  `;
  return `<svg class="stats-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pages edited per month, last 24 months">${yTicks}${bars}${labels}</svg>`;
}

function renderHorizontalBars(
  data: Array<{ label: string; count: number; href?: string }>,
): string {
  if (data.length === 0) return `<p class="stats-empty">No data.</p>`;
  const max = Math.max(1, ...data.map((d) => d.count));
  const rows = data
    .map((d) => {
      const pct = (d.count / max) * 100;
      // Gate href through `safeLinkUrl` so a tampered sitemap/manifest
      // entry can't smuggle `javascript:` into the stats page. Mirrors the
      // gate every other anchor in the project uses.
      const labelHtml = d.href
        ? `<a href="${mdUrl(safeLinkUrl(d.href))}">${escapeHtmlText(d.label)}</a>`
        : escapeHtmlText(d.label);
      return `<li class="stats-row">
        <span class="stats-row-label">${labelHtml}</span>
        <span class="stats-row-bar"><span class="stats-row-fill" style="width:${pct.toFixed(2)}%"></span></span>
        <span class="stats-row-count">${d.count.toLocaleString("en-US")}</span>
      </li>`;
    })
    .join("");
  return `<ul class="stats-rows">${rows}</ul>`;
}

interface WriteStatsOpts {
  archiveTitle: string;
  archiveIcon?: string;
  generatedAt: string;
}

export async function writeStatsPage(
  htmlDir: string,
  stats: StatsBundle,
  opts: WriteStatsOpts,
): Promise<string> {
  const { totals, recent, activityByMonth, blockTypes, topRecent, topSections, newest, oldest } =
    stats;
  const archiveTitle = opts.archiveTitle || "Workspace";
  const generatedLabel = (() => {
    try {
      const d = new Date(opts.generatedAt);
      if (Number.isNaN(d.getTime())) return opts.generatedAt;
      const iso = d.toISOString();
      return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    } catch {
      return opts.generatedAt;
    }
  })();

  const counters = [
    { label: "Pages", value: totals.pages.toLocaleString("en-US") },
    { label: "Databases", value: totals.databases.toLocaleString("en-US") },
    { label: "Database rows", value: totals.dbRows.toLocaleString("en-US") },
    { label: "Assets", value: totals.assets.toLocaleString("en-US") },
    { label: "Asset size", value: formatBytes(totals.assetBytes) },
    { label: "Raw JSON size", value: formatBytes(totals.rawBytes) },
  ]
    .map(
      (c) =>
        `<div class="stats-counter"><dt>${escapeHtmlText(c.label)}</dt><dd>${escapeHtmlText(c.value)}</dd></div>`,
    )
    .join("");

  const recentCards = [
    { label: "Last 7 days", value: recent.d7 },
    { label: "Last 30 days", value: recent.d30 },
    { label: "Last 90 days", value: recent.d90 },
    { label: "Last 365 days", value: recent.d365 },
  ]
    .map(
      (c) =>
        `<div class="stats-counter stats-counter-recent"><dt>${escapeHtmlText(c.label)}</dt><dd>${c.value.toLocaleString("en-US")}</dd></div>`,
    )
    .join("");

  const blockBars = renderHorizontalBars(
    blockTypes.map((b) => ({ label: b.type, count: b.count })),
  );
  const sectionBars = renderHorizontalBars(
    topSections.map((s) => ({ label: s.section, count: s.count })),
  );

  const recentList = topRecent
    .map(
      (p) =>
        // safeLinkUrl gate — see renderHorizontalBars above.
        `<li><a href="${mdUrl(safeLinkUrl(p.href))}">${escapeHtmlText(p.title)}</a><time>${escapeHtmlText(formatDate(p.lastEdited))}</time></li>`,
    )
    .join("");

  const newestLine = newest
    ? `<p class="stats-bookend"><span class="stats-bookend-label">Most recent edit:</span> <a href="${mdUrl(safeLinkUrl(newest.href))}">${escapeHtmlText(newest.title)}</a> <time>${escapeHtmlText(formatDate(newest.date))}</time></p>`
    : "";
  const oldestLine = oldest
    ? `<p class="stats-bookend"><span class="stats-bookend-label">Oldest still-tracked edit:</span> <a href="${mdUrl(safeLinkUrl(oldest.href))}">${escapeHtmlText(oldest.title)}</a> <time>${escapeHtmlText(formatDate(oldest.date))}</time></p>`
    : "";

  const activityChart = renderActivityChart(activityByMonth);

  const body = `<div class="stats-layout"><header class="stats-hero">
  <h1>Workspace statistics</h1>
  <p class="stats-generated">Generated ${escapeHtmlText(generatedLabel)}</p>
</header>

<section class="stats-section">
  <h2>Totals</h2>
  <dl class="stats-counters">${counters}</dl>
</section>

<section class="stats-section">
  <h2>Recent activity</h2>
  <dl class="stats-counters">${recentCards}</dl>
  ${newestLine}${oldestLine}
</section>

<section class="stats-section">
  <h2>Edits per month <span class="stats-section-sub">(last 24 months)</span></h2>
  ${activityChart}
</section>

<section class="stats-section stats-two-col">
  <div>
    <h2>Block-type distribution</h2>
    ${blockBars}
  </div>
  <div>
    <h2>Pages per top-level section</h2>
    ${sectionBars}
  </div>
</section>

<section class="stats-section">
  <h2>Recently edited</h2>
  <ol class="stats-recent-list">${recentList}</ol>
</section></div>
`;

  const html = renderChrome({
    title: `Statistics — ${archiveTitle}`,
    bodyHtml: body,
    breadcrumbTail: "Statistics",
    archiveTitle,
    archiveIcon: opts.archiveIcon,
    bodyClass: "stats-page",
  });
  const abs = path.join(htmlDir, "stats.html");
  await fsp.writeFile(abs, html);
  return abs;
}
