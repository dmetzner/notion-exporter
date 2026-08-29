// Helpers that pull commonly used fields out of an opaque Notion page/database object.

import { relUrl } from "../export/paths.js";
import { assertWithinRoot } from "../util/fs.js";

export interface IconRef {
  kind: "emoji" | "external" | "file";
  value: string; // emoji char, or URL (external/file local_path)
}

export interface CoverRef {
  url: string;
  localPath?: string;
}

/**
 * Raw shape of a Notion icon/cover payload as it appears nested under
 * `page.icon`, `page.cover`, `database.icon`, etc. Mirrors the SDK response
 * shape (kept permissive — every field is optional) plus the local-path
 * extension we mutate in once the asset has been downloaded.
 *
 * Promoted from `rerender.ts` (`MediaPayload`) / `repair.ts` (`PayloadMedia`)
 * — same shape, two names, picked the audit's suggested home and name.
 */
export type NotionMediaPayload = {
  type?: string;
  emoji?: string;
  file?: { url?: string; local_path?: string };
  external?: { url?: string; local_path?: string };
} | null;

interface PageLike {
  icon?: {
    type?: "emoji" | "external" | "file";
    emoji?: string;
    external?: { url?: string };
    file?: { url?: string; local_path?: string };
  } | null;
  cover?: {
    type?: "external" | "file";
    external?: { url?: string };
    file?: { url?: string; local_path?: string };
  } | null;
}

export function extractIcon(page: unknown): IconRef | null {
  const p = page as PageLike;
  const i = p?.icon;
  if (!i) return null;
  if (i.type === "emoji" && i.emoji) return { kind: "emoji", value: i.emoji };
  if (i.type === "external" && i.external?.url) return { kind: "external", value: i.external.url };
  // When the asset hasn't been
  // downloaded yet, return null instead of falling back to the remote
  // Notion S3 URL. Those URLs carry `X-Amz-Signature` query params and
  // expire after ~1h — leaking one into the page-icon `<img src>` ships
  // a broken icon and a credentialed URL into static HTML. Mirrors
  // `rebuildIconMeta`'s null-on-missing-local-path posture.
  if (i.type === "file" && i.file?.local_path) {
    return { kind: "file", value: i.file.local_path };
  }
  return null;
}

/**
 * Return the remote URL for a page/database icon if it's a file/external
 * type — i.e. the URL the asset collector needs to download. Distinct
 * from `extractIcon`, which intentionally returns null for file icons
 * whose `local_path` is missing (never leak the signed S3 URL into
 * rendered HTML). Used only on the download side.
 */
export function extractIconUrlForDownload(page: unknown): string | null {
  const p = page as PageLike;
  const i = p?.icon;
  if (!i) return null;
  if (i.type === "external" && i.external?.url) return i.external.url;
  if (i.type === "file" && i.file?.url) return i.file.url;
  return null;
}

export function extractCover(page: unknown): CoverRef | null {
  const p = page as PageLike;
  const c = p?.cover;
  if (!c) return null;
  if (c.type === "external" && c.external?.url) return { url: c.external.url };
  if (c.type === "file" && (c.file?.local_path || c.file?.url)) {
    return { url: c.file.url ?? "", localPath: c.file.local_path };
  }
  return null;
}

// Build a SitemapEntry icon ref from a Notion page/database. Emoji icons are
// returned as-is; image icons resolve to the localized asset path with one
// `../` hop so the sidebar — consumed from inside `html/` — can find them
// regardless of the page's subdir depth. Shared by export + rerender so the
// two paths can't drift.
export function sitemapIconFromObj(
  obj: unknown,
): { kind: "emoji"; value: string } | { kind: "image"; value: string } | undefined {
  const icon = extractIcon(obj);
  if (!icon) return undefined;
  if (icon.kind === "emoji") return { kind: "emoji", value: icon.value };
  const p = obj as {
    icon?: { file?: { local_path?: string }; external?: { local_path?: string } };
  };
  const local = p.icon?.file?.local_path ?? p.icon?.external?.local_path;
  if (local) return { kind: "image", value: `../${local}` };
  return undefined;
}

export function notionUrlFor(id: string): string {
  return `https://notion.so/${id.replace(/-/g, "")}`;
}

interface IconCarrier {
  icon?: {
    file?: { local_path?: string };
    external?: { local_path?: string };
  } | null;
}

interface CoverCarrier {
  cover?: {
    file?: { local_path?: string };
    external?: { local_path?: string };
  } | null;
}

/**
 * Rebuild a renderable icon descriptor for a previously-exported page or
 * database — emoji icons pass through unchanged, image icons resolve to a
 * filesystem-relative path under `exportRoot` (validated via
 * `assertWithinRoot`) and made relative to `fromDir`.
 *
 * Returns `null` when no icon is present or the localized path is missing.
 * Shared by `rerender` + `repair` so the two paths can't drift.
 */
export function rebuildIconMeta(
  obj: unknown,
  exportRoot: string,
  fromDir: string,
): { kind: "emoji" | "image"; value: string } | null {
  const icon = extractIcon(obj);
  if (!icon) return null;
  if (icon.kind === "emoji") return { kind: "emoji", value: icon.value };
  const carrier = obj as IconCarrier | null;
  const local = carrier?.icon?.file?.local_path ?? carrier?.icon?.external?.local_path;
  if (!local) return null;
  return {
    kind: "image",
    value: relUrl(fromDir, assertWithinRoot(exportRoot, local)),
  };
}

/**
 * Mirror of `rebuildIconMeta` for cover images. Returns a filesystem-relative
 * URL string or `null` when the page has no cover (or its asset hasn't been
 * localized yet).
 */
export function rebuildCoverMeta(obj: unknown, exportRoot: string, fromDir: string): string | null {
  const cover = extractCover(obj);
  if (!cover?.url) return null;
  const carrier = obj as CoverCarrier | null;
  const local = carrier?.cover?.file?.local_path ?? carrier?.cover?.external?.local_path;
  if (!local) return null;
  return relUrl(fromDir, assertWithinRoot(exportRoot, local));
}

// Resolve the operator-supplied `EXPORT_ICON` value to something the
// sidebar/index renderers can use:
//   - emoji / short text: returned as-is (renders as a glyph)
//   - http(s):// URL    : downloaded once via the asset collector → returned
//     as `assets/<hash>.<ext>` so it's offline-readable
//   - relative path     : returned as-is (caller already placed the file)
// Returns null when the input is empty.
export async function resolveArchiveIcon(
  raw: string | undefined,
  download: (url: string, hint?: string) => Promise<{ localPath: string }>,
): Promise<string | null> {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    try {
      const rec = await download(v);
      return rec.localPath;
    } catch {
      // Fall back to the original URL so the icon still loads while online,
      // even if we couldn't cache it locally for the offline export.
      return v;
    }
  }
  return v;
}
