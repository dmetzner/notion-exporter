import path from "node:path";

export interface ExportPaths {
  root: string;
  raw: string;
  markdown: string;
  html: string;
  assets: string;
  manifest: string;
}

export function timestampDir(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
}

/** `path.relative()` for values that become web hrefs/srcs in generated HTML.
 * Forces POSIX "/" separators so paths work in a browser even when the export
 * is produced on Windows, where `path.relative` would otherwise emit "\". */
export function relUrl(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export function buildPaths(outDir: string, stamp = timestampDir()): ExportPaths {
  const root = path.join(outDir, stamp);
  return {
    root,
    raw: path.join(root, "raw"),
    markdown: path.join(root, "markdown"),
    html: path.join(root, "html"),
    assets: path.join(root, "assets"),
    manifest: path.join(root, "manifest.json"),
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: filename sanitizer intentionally strips control chars
const INVALID = /[<>:"/\\|?*\x00-\x1f]/g;

// Windows reserved device names — disallowed as filenames regardless of extension.
const WIN_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/** Fallback display title for a page that has no title set. Shared across
 * markdown/HTML render paths so all three render-loops agree on the same
 * placeholder text. */
export const UNTITLED_PAGE = "(untitled)";

/** Fallback display title for a database with no title. Pair with
 * {@link UNTITLED_PAGE}. */
export const UNTITLED_DB = "(untitled database)";

/** Fallback filesystem segment for `safeSegment` when the input normalizes to
 * empty. Lowercase + no parens because filesystems and URL paths don't love
 * either. */
export const UNTITLED_SEGMENT = "untitled";

export function safeSegment(name: string, fallback = UNTITLED_SEGMENT): string {
  let s = name.normalize("NFKD").replace(INVALID, "_").trim();
  s = s.replace(/\s+/g, " ").slice(0, 120);
  // Trim trailing dots/spaces — Windows treats them as illegal/auto-stripped.
  s = s.replace(/[. ]+$/g, "");
  // Trim leading dots/spaces too — leading dot hides files on Unix.
  s = s.replace(/^[. ]+/g, "");
  if (!s || s === "." || s === "..") return fallback;
  if (WIN_RESERVED.has(s.toUpperCase())) return `_${s}`;
  return s;
}
