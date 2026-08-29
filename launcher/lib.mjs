// Notion Export launcher - shared helpers (Windows / macOS / Linux).
//
// One place for the things refresh.mjs and tui.mjs both need: where the repo
// is, where exports land, how to find the newest one, and how to open a file
// with the OS default handler. Pure Node, no dependencies.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const isWin = process.platform === "win32";

// launcher/ lives inside the notion-exporter repo, so the repo root is its
// parent. Override with NOTION_EXPORTER_DIR if the layout ever differs.
export const launcherDir = path.dirname(fileURLToPath(import.meta.url));
export const repoDir = process.env.NOTION_EXPORTER_DIR
  ? path.resolve(process.env.NOTION_EXPORTER_DIR)
  : path.resolve(launcherDir, "..");

// OUT_DIR from the repo's .env.local (preferred) or .env; else <repo>/exports.
export function readOutDir() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(repoDir, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*OUT_DIR\s*=\s*(.+?)\s*$/);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v) return path.isAbsolute(v) ? v : path.resolve(repoDir, v);
      }
    }
  }
  return path.join(repoDir, "exports");
}

// Newest stamped export dir that actually finished (has a manifest.json).
export function findLatestExport(outDir = readOutDir()) {
  if (!existsSync(outDir)) return null;
  const dirs = readdirSync(outDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const n of dirs) {
    if (existsSync(path.join(outDir, n, "manifest.json"))) return path.join(outDir, n);
  }
  return null;
}

// Open a file/folder/URL with the OS default handler.
export function openTarget(target) {
  if (isWin) spawnSync("cmd", ["/c", "start", "", target], { stdio: "ignore" });
  else if (process.platform === "darwin") spawnSync("open", [target], { stdio: "ignore" });
  else spawnSync("xdg-open", [target], { stdio: "ignore" });
}
